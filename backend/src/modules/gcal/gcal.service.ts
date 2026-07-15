import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { GaxiosError } from "gaxios";
import { google } from "googleapis";

import { env } from "../../config/env.js";
import { qAll, qExec, qGet } from "../../db/query.js";
import { log } from "../../logger.js";

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

// calendar scope enables both read and write (events.insert); existing tokens with
// readonly scope will get a 403 on write and we surface a NEEDS_REAUTH error.
const GCAL_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

// ---------------------------------------------------------------------------
// Refresh token encryption at rest — separate key purpose from Drive tokens
// ---------------------------------------------------------------------------

function deriveTokenKey(): Buffer {
  return createHash("sha256").update(`household-finance:gcal-token:${env.JWT_SECRET}`).digest();
}

function encryptToken(plaintext: string): string {
  const key = deriveTokenKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decryptToken(stored: string): string | null {
  try {
    const buf = Buffer.from(stored, "base64");
    if (buf.length < 28) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const key = deriveTokenKey();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth state (HMAC-signed, 15-min TTL)
// ---------------------------------------------------------------------------

type GCalOAuthStatePayload = { householdId: string; userId: string; exp: number };

function signStatePayload(dataB64url: string): string {
  return createHmac("sha256", env.JWT_SECRET).update(dataB64url).digest("base64url");
}

function encodeGCalOAuthState(payload: { householdId: string; userId: string }): string {
  const body: GCalOAuthStatePayload = { ...payload, exp: Date.now() + OAUTH_STATE_TTL_MS };
  const data = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  const sig = signStatePayload(data);
  return `${data}.${sig}`;
}

export function decodeGCalOAuthState(
  state: string
): { ok: true; householdId: string; userId: string } | { ok: false; message: string } {
  const parts = state.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, message: "Invalid state." };
  }
  const [dataB64, sig] = parts;
  const expected = signStatePayload(dataB64);
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, message: "Invalid state signature." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, message: "Invalid state payload." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "Invalid state payload." };
  }
  const o = parsed as Record<string, unknown>;
  const householdId = typeof o.householdId === "string" ? o.householdId : "";
  const userId = typeof o.userId === "string" ? o.userId : "";
  const exp = typeof o.exp === "number" ? o.exp : 0;
  if (!householdId || !userId) return { ok: false, message: "Incomplete state." };
  if (Date.now() > exp) return { ok: false, message: "State expired. Please try again." };
  return { ok: true, householdId, userId };
}

// ---------------------------------------------------------------------------
// OAuth URL
// ---------------------------------------------------------------------------

export function buildGCalConsentUrl(householdId: string, userId: string): string {
  const state = encodeGCalOAuthState({ householdId, userId });
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_CALENDAR_REDIRECT_URI
  );
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GCAL_SCOPES,
    state
  });
}

// ---------------------------------------------------------------------------
// Token exchange + storage
// ---------------------------------------------------------------------------

export async function exchangeAndSaveCalendar(
  householdId: string,
  userId: string,
  code: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_CALENDAR_REDIRECT_URI
  );
  let refreshToken: string;
  let accessToken: string | null = null;
  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return { ok: false, message: "No refresh token returned — ensure prompt=consent was set." };
    }
    refreshToken = tokens.refresh_token;
    accessToken = tokens.access_token ?? null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("gcal OAuth code exchange failed", { userId, householdId, msg });
    return { ok: false, message: `OAuth code exchange failed: ${msg}` };
  }

  let providerEmail: string | null = null;
  try {
    client.setCredentials({ access_token: accessToken });
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const userinfoRes = await oauth2.userinfo.get();
    providerEmail = userinfoRes.data.email ?? null;
  } catch (err) {
    log.warn("gcal: could not fetch userinfo email", { userId, err: err instanceof Error ? err.message : String(err) });
  }

  await connectGCal(householdId, userId, refreshToken, providerEmail);
  return { ok: true };
}

async function connectGCal(
  householdId: string,
  userId: string,
  refreshToken: string,
  providerEmail: string | null = null
): Promise<void> {
  await qExec(
    `INSERT INTO oauth_integrations
     (provider, household_id, user_id, refresh_token, provider_email, connected_by_user_id, last_verified_at, last_error, needs_reauth)
     VALUES ('google_calendar', ?, ?, ?, ?, ?, NOW(), NULL, FALSE)
     ON CONFLICT (user_id, provider) WHERE user_id IS NOT NULL DO UPDATE SET
       refresh_token = EXCLUDED.refresh_token,
       provider_email = EXCLUDED.provider_email,
       connected_at = NOW(),
       connected_by_user_id = EXCLUDED.connected_by_user_id,
       last_verified_at = NOW(),
       last_error = NULL,
       needs_reauth = FALSE`,
    householdId,
    userId,
    encryptToken(refreshToken),
    providerEmail,
    userId
  );
}

export async function disconnectGCal(userId: string): Promise<void> {
  await qExec(
    `DELETE FROM oauth_integrations WHERE provider = 'google_calendar' AND user_id = ?`,
    userId
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type GCalStatus = {
  connected: boolean;
  connectedAt: string | null;
  needsReauth: boolean;
  lastError: string | null;
};

export async function getGCalStatus(userId: string): Promise<GCalStatus> {
  const row = await qGet<{
    connected_at: string;
    needs_reauth: boolean;
    last_error: string | null;
  }>(
    `SELECT connected_at, needs_reauth, last_error
     FROM oauth_integrations
     WHERE provider = 'google_calendar' AND user_id = ?`,
    userId
  );
  if (!row) return { connected: false, connectedAt: null, needsReauth: false, lastError: null };
  return {
    connected: true,
    connectedAt: String(row.connected_at),
    needsReauth: Boolean(row.needs_reauth),
    lastError: row.last_error ?? null
  };
}

// ---------------------------------------------------------------------------
// Calendar client
// ---------------------------------------------------------------------------

export async function getDecryptedRefreshToken(userId: string): Promise<string | null> {
  const row = await qGet<{ refresh_token: string | null }>(
    `SELECT refresh_token FROM oauth_integrations WHERE provider = 'google_calendar' AND user_id = ?`,
    userId
  );
  if (!row?.refresh_token) return null;
  return decryptToken(row.refresh_token);
}

export function buildOAuth2Client(refreshToken: string): InstanceType<typeof google.auth.OAuth2> {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_CALENDAR_REDIRECT_URI
  );
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type GCalEvent = {
  id: string;
  summary: string | null;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  description: string | null;
  calendarId: string;
};

export async function listUpcomingEvents(
  userId: string,
  daysAhead: number = 14
): Promise<{ ok: true; events: GCalEvent[] } | { ok: false; code: string; message: string }> {
  const rt = await getDecryptedRefreshToken(userId);
  if (!rt) {
    return { ok: false, code: "GCAL_NOT_CONNECTED", message: "Google Calendar is not connected." };
  }

  const auth = buildOAuth2Client(rt);
  const calendar = google.calendar({ version: "v3", auth });

  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000).toISOString();

  try {
    const selectedIds = await getCalendarSelection(userId);

    let calendarIds: string[];
    if (selectedIds && selectedIds.length > 0) {
      calendarIds = selectedIds;
    } else {
      const res = await calendar.calendarList.list({ minAccessRole: "reader" });
      calendarIds = (res.data.items ?? []).map(c => c.id).filter((id): id is string => !!id);
    }

    const allEvents: GCalEvent[] = [];

    for (const calId of calendarIds) {
      try {
        const evRes = await calendar.events.list({
          calendarId: calId,
          timeMin,
          timeMax,
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 250
        });
        for (const ev of evRes.data.items ?? []) {
          const startDateTime = ev.start?.dateTime ?? ev.start?.date ?? null;
          const endDateTime = ev.end?.dateTime ?? ev.end?.date ?? null;
          allEvents.push({
            id: ev.id ?? "",
            summary: ev.summary ?? null,
            start: startDateTime,
            end: endDateTime,
            allDay: !ev.start?.dateTime,
            location: ev.location ?? null,
            description: ev.description ?? null,
            calendarId: calId
          });
        }
      } catch (calErr: unknown) {
        const calHttpStatus = calErr instanceof GaxiosError ? calErr.response?.status : undefined;
        const calMsg = calErr instanceof Error ? calErr.message : String(calErr);
        log.warn("gcal: skipping calendar due to fetch error", { userId, calendarId: calId, httpStatus: calHttpStatus, msg: calMsg });
      }
    }

    allEvents.sort((a, b) => {
      if (!a.start) return 1;
      if (!b.start) return -1;
      return a.start.localeCompare(b.start);
    });

    return { ok: true, events: allEvents };
  } catch (err: unknown) {
    const httpStatus = err instanceof GaxiosError ? err.response?.status : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("gcal listUpcomingEvents failed", { userId, httpStatus, msg });

    if (httpStatus === 401 || httpStatus === 403) {
      await qExec(
        `UPDATE oauth_integrations SET needs_reauth = TRUE, last_error = ?
         WHERE provider = 'google_calendar' AND user_id = ?`,
        msg.slice(0, 500),
        userId
      );
      return { ok: false, code: "GCAL_NEEDS_REAUTH", message: "Calendar access requires re-authorization." };
    }

    return { ok: false, code: "GCAL_API_ERROR", message: `Calendar API error: ${msg}` };
  }
}

// ---------------------------------------------------------------------------
// Calendar list + selection
// ---------------------------------------------------------------------------

export type GCalCalendarItem = {
  id: string;
  summary: string;
  primary: boolean;
  backgroundColor: string | null;
};

export async function listUserCalendars(
  userId: string
): Promise<{ ok: true; calendars: GCalCalendarItem[] } | { ok: false; code: string; message: string }> {
  const rt = await getDecryptedRefreshToken(userId);
  if (!rt) {
    return { ok: false, code: "GCAL_NOT_CONNECTED", message: "Google Calendar is not connected." };
  }

  const auth = buildOAuth2Client(rt);
  const calendar = google.calendar({ version: "v3", auth });

  try {
    const res = await calendar.calendarList.list({ minAccessRole: "reader" });
    const items = (res.data.items ?? []).map(cal => ({
      id: cal.id ?? "",
      summary: cal.summary ?? cal.id ?? "",
      primary: cal.primary === true,
      backgroundColor: cal.backgroundColor ?? null
    })).filter(c => c.id);
    return { ok: true, calendars: items };
  } catch (err: unknown) {
    const httpStatus = err instanceof GaxiosError ? err.response?.status : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("gcal listUserCalendars failed", { userId, httpStatus, msg });
    if (httpStatus === 401 || httpStatus === 403) {
      await qExec(
        `UPDATE oauth_integrations SET needs_reauth = TRUE, last_error = ?
         WHERE provider = 'google_calendar' AND user_id = ?`,
        msg.slice(0, 500),
        userId
      );
      return { ok: false, code: "GCAL_NEEDS_REAUTH", message: "Calendar access requires re-authorization." };
    }
    return { ok: false, code: "GCAL_API_ERROR", message: `Calendar API error: ${msg}` };
  }
}

export async function saveCalendarSelection(userId: string, calendarIds: string[]): Promise<void> {
  await qExec(
    `UPDATE oauth_integrations
     SET selected_calendar_ids = ?, calendars_fetched_at = NOW()
     WHERE provider = 'google_calendar' AND user_id = ?`,
    JSON.stringify(calendarIds),
    userId
  );
}

export async function getCalendarSelection(
  userId: string
): Promise<string[] | null> {
  const row = await qGet<{ selected_calendar_ids: string | null }>(
    `SELECT selected_calendar_ids FROM oauth_integrations
     WHERE provider = 'google_calendar' AND user_id = ?`,
    userId
  );
  if (!row?.selected_calendar_ids) return null;
  try {
    const parsed = JSON.parse(row.selected_calendar_ids) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Per-calendar role (FIX #212) — distinguishes school calendars from parent
// commitment calendars so the family agent doesn't treat a school closure as
// a parent being unavailable.
// ---------------------------------------------------------------------------

export type CalendarRole = "work" | "school" | "activities" | "other";

/** Default guess when no explicit role is saved — name-based, never authoritative. */
export function heuristicCalendarRole(summary: string): CalendarRole {
  const s = summary.toLowerCase();
  if (s.includes("school") || s.includes("class") || /\bisd\b/.test(s)) return "school";
  if (s.includes("activit") || s.includes("sport") || s.includes("camp")) return "activities";
  return "work";
}

export async function saveCalendarRoles(userId: string, roles: Record<string, CalendarRole>): Promise<void> {
  await qExec(
    `UPDATE oauth_integrations SET calendar_roles = ? WHERE provider = 'google_calendar' AND user_id = ?`,
    JSON.stringify(roles),
    userId
  );
}

export async function getCalendarRoles(userId: string): Promise<Record<string, CalendarRole>> {
  const row = await qGet<{ calendar_roles: string | null }>(
    `SELECT calendar_roles FROM oauth_integrations WHERE provider = 'google_calendar' AND user_id = ?`,
    userId
  );
  if (!row?.calendar_roles) return {};
  try {
    const parsed = JSON.parse(row.calendar_roles) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, CalendarRole>;
    return {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Authorization guard for Calendar (owner or admin)
// ---------------------------------------------------------------------------

export async function assertCanConnectCalendar(userId: string, householdId: string): Promise<boolean> {
  const row = await qGet<{ role: string; household_id: string }>(
    `SELECT role, household_id FROM app_user WHERE id = ?`,
    userId
  );
  return Boolean(
    row &&
      row.household_id === householdId &&
      (row.role === "owner" || row.role === "admin")
  );
}

// ---------------------------------------------------------------------------
// Calendar write-back — create an event on the user's primary calendar
// ---------------------------------------------------------------------------

export type NewCalendarEvent = {
  title: string;
  date: string;        // ISO date YYYY-MM-DD
  time?: string;       // HH:MM (24h); omit for all-day
  durationMins?: number;
  description?: string;
  attendees?: string[];
};

export type CreateCalendarEventResult =
  | { ok: true; eventId: string; eventLink: string | null }
  | { ok: false; code: "GCAL_NOT_CONNECTED" | "GCAL_NEEDS_REAUTH" | "GCAL_WRITE_ERROR" | "GCAL_INVALID_DATE"; message: string };

export async function createCalendarEvent(
  userId: string,
  householdId: string,
  event: NewCalendarEvent
): Promise<CreateCalendarEventResult> {
  const refreshToken = await getDecryptedRefreshToken(userId);
  if (!refreshToken) return { ok: false, code: "GCAL_NOT_CONNECTED", message: "Google Calendar is not connected for this user." };

  const auth = buildOAuth2Client(refreshToken);
  const calendar = google.calendar({ version: "v3", auth });

  let start: { date: string } | { dateTime: string; timeZone: string };
  let end: { date: string } | { dateTime: string; timeZone: string };

  if (event.time) {
    // Treat date+time as local wall-clock in the household timezone (env.TZ).
    const durationMins = event.durationMins ?? 15;
    const [h, m] = event.time.split(":").map(Number);
    const endTotalMins = h * 60 + m + durationMins;
    const endH = String(Math.floor(endTotalMins / 60) % 24).padStart(2, "0");
    const endM = String(endTotalMins % 60).padStart(2, "0");
    start = { dateTime: `${event.date}T${event.time}:00`, timeZone: env.TZ };
    end = { dateTime: `${event.date}T${endH}:${endM}:00`, timeZone: env.TZ };
  } else {
    // All-day event
    if (!event.date || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) || isNaN(new Date(event.date).getTime())) {
      return { ok: false, code: "GCAL_INVALID_DATE", message: `Invalid event date: "${event.date}"` };
    }
    const nextDay = new Date(event.date);
    nextDay.setDate(nextDay.getDate() + 1);
    start = { date: event.date };
    end = { date: nextDay.toISOString().slice(0, 10) };
  }

  // Add all other connected parents in the household as attendees so the event
  // lands on their primary Google Calendar via invite.
  const coParentRows = await qAll<{ provider_email: string }>(
    `SELECT provider_email FROM oauth_integrations
     WHERE provider = 'google_calendar'
       AND household_id = ?
       AND user_id != ?
       AND needs_reauth = FALSE
       AND provider_email IS NOT NULL`,
    householdId,
    userId
  );
  const coParentEmails = coParentRows.map(r => r.provider_email);
  const allAttendees = [...(event.attendees ?? []), ...coParentEmails];

  try {
    const res = await calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: event.title,
        description: event.description,
        start,
        end,
        attendees: allAttendees.length > 0 ? allAttendees.map((email) => ({ email })) : undefined,
      },
    });
    return {
      ok: true,
      eventId: res.data.id ?? "",
      eventLink: res.data.htmlLink ?? null,
    };
  } catch (err: unknown) {
    const status = (err as { code?: number }).code;
    if (status === 401 || status === 403) {
      // Token lacks write scope — mark needs_reauth so user gets prompted to reconnect
      await qExec(
        `UPDATE oauth_integrations SET needs_reauth = TRUE WHERE provider = 'google_calendar' AND user_id = ?`,
        userId
      );
      return { ok: false, code: "GCAL_NEEDS_REAUTH", message: "Google Calendar needs to be reconnected to enable write access." };
    }
    return { ok: false, code: "GCAL_WRITE_ERROR", message: err instanceof Error ? err.message : "Calendar event creation failed." };
  }
}
