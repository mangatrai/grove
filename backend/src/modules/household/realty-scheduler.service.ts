/**
 * Monthly background scheduler for real estate property valuation (D-2).
 *
 * Heartbeat every 6 hours. Refreshes each property that has api_property_id set
 * (i.e. Redfin IDs stored) and has not been fetched in the last 28 days.
 * Skips gracefully if REALTYAPI_KEY is not configured.
 */

import { qAll } from "../../db/query.js";
import { log } from "../../logger.js";
import { isRealtyApiConfigured } from "./realty-api.service.js";
import { refreshPropertyValuation } from "./property.service.js";
import { createNotification } from "../notifications/notification.service.js";

const HEARTBEAT_MS = 6 * 60 * 60 * 1000;   // every 6 h
const STARTUP_DELAY_MS = 60_000;             // 1 min after boot
const REFRESH_INTERVAL_DAYS = 28;

let schedulerStarted = false;

export function startRealtyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  setTimeout(() => void checkAndRefreshProperties(), STARTUP_DELAY_MS);
  setInterval(() => void checkAndRefreshProperties(), HEARTBEAT_MS);
}

async function checkAndRefreshProperties(): Promise<void> {
  if (!isRealtyApiConfigured()) return;

  const rows = await qAll<{ id: string; household_id: string }>(
    `SELECT id, household_id FROM property
      WHERE api_property_id IS NOT NULL
        AND (
          valuation_fetched_at IS NULL
          OR valuation_fetched_at < NOW() - INTERVAL '${REFRESH_INTERVAL_DAYS} days'
        )`
  );

  if (rows.length === 0) return;
  log.info(`Realty scheduler: ${rows.length} propert${rows.length === 1 ? "y" : "ies"} due for refresh`);

  for (const row of rows) {
    try {
      const result = await refreshPropertyValuation(row.id, row.household_id);
      if (result.ok) {
        log.info(`Realty scheduler: refreshed ${row.id} → $${result.estimate}`);
        void createNotification({
          householdId: row.household_id,
          type: "property_valuation_updated",
          title: "Property valuation updated",
          body: `Your property estimate has been refreshed to $${result.estimate.toLocaleString("en-US")}.`,
          actionUrl: "/real-estate"
        });
      } else {
        log.warn(`Realty scheduler: skipped ${row.id} — ${result.message}`);
      }
      // 2-second pause between calls to stay well under rate limits
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      log.error(`Realty scheduler: ${row.id} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
