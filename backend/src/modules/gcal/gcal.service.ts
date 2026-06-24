import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { GaxiosError } from "gaxios";
import { google } from "googleapis";

import { env } from "../../config/env.js";
import { qExec, qGet } from "../../db/query.js";
import { log } from "../../logger.js";

const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

const GCAL_SCOPES = ["https://www.googleapis.com/auth/calendar.readonly"];

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

export function encodeGCalOAuthState(payload: { householdId: string; userId: string }): string {
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
  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      return { ok: false, message: "No refresh token returned — ensure prompt=consent was set." };
    }
    refreshToken = tokens.refresh_token;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("gcal OAuth code exchange failed", { userId, householdId, msg });
    return { ok: false, message: `OAuth code exchange failed: ${msg}` };
  }
  await connectGCal(householdId, userId, refreshToken);
  return { ok: true };
}

export async function connectGCal(householdId: string, userId: string, refreshToken: string): Promise<void> {
  await qExec(
    `INSERT INTO oauth_integrations
     (provider, household_id, user_id, refresh_token, connected_by_user_id, last_verified_at, last_error, needs_reauth)
     VALUES ('google_calendar', ?, ?, ?, ?, NOW(), NULL, FALSE)
     ON CONFLICT (user_id, provider) WHERE user_id IS NOT NULL DO UPDATE SET
       refresh_token = EXCLUDED.refresh_token,
       connected_at = NOW(),
       connected_by_user_id = EXCLUDED.connected_by_user_id,
       last_verified_at = NOW(),
       last_error = NULL,
       needs_reauth = FALSE`,
    householdId,
    userId,
    encryptToken(refreshToken),
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

async function getDecryptedRefreshToken(userId: string): Promise<string | null> {
  const row = await qGet<{ refresh_token: string | null }>(
    `SELECT refresh_token FROM oauth_integrations WHERE provider = 'google_calendar' AND user_id = ?`,
    userId
  );
  if (!row?.refresh_token) return null;
  return decryptToken(row.refresh_token);
}

function buildOAuth2Client(refreshToken: string): InstanceType<typeof google.auth.OAuth2> {
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
