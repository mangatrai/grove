/**
 * Monthly background scheduler for real estate property valuation (D-2).
 *
 * Fires on the 1st of every month at 10 PM CT. Refreshes each property that has
 * api_property_id set and has not been fetched in the last 28 days.
 * Skips gracefully if REALTY_API_KEY is not configured.
 */

import cron from "node-cron";

import { qAll } from "../../db/query.js";
import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { isRealtyApiConfigured } from "./realty-api.service.js";
import { refreshPropertyValuation } from "./property.service.js";
import { createNotification } from "../notifications/notification.service.js";

const REFRESH_INTERVAL_DAYS = 28;

let schedulerStarted = false;

export function startRealtyScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  // 1st of every month at 10 PM local time (TZ env var). Fires at wall-clock time regardless of DST.
  cron.schedule("0 22 1 * *", () => { void checkAndRefreshProperties(); }, {
    timezone: env.TZ,
  });
}

async function checkAndRefreshProperties(): Promise<void> {
  if (!isRealtyApiConfigured()) return;

  const rows = await qAll<{ id: string; household_id: string; address_line1: string | null }>(
    `SELECT id, household_id, address_line1 FROM property
      WHERE api_property_id IS NOT NULL
        AND (
          valuation_fetched_at IS NULL
          OR valuation_fetched_at < NOW() - INTERVAL '${REFRESH_INTERVAL_DAYS} days'
        )`
  );

  if (rows.length === 0) return;
  log.info(`Realty scheduler: ${rows.length} propert${rows.length === 1 ? "y" : "ies"} due for refresh`);

  for (const row of rows) {
    const label = row.address_line1 ?? row.id;
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
        void createNotification({
          householdId: row.household_id,
          type: "property_valuation_failed",
          title: "Property valuation refresh failed",
          body: `Could not refresh estimate for ${label}: ${result.message}`,
          actionUrl: `/real-estate/${row.id}`
        });
      }
      // 2-second pause between calls to stay well under rate limits
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Realty scheduler: ${row.id} — ${msg}`);
      void createNotification({
        householdId: row.household_id,
        type: "property_valuation_failed",
        title: "Property valuation refresh failed",
        body: `An error occurred refreshing estimate for ${label}.`,
        actionUrl: `/real-estate/${row.id}`
      });
    }
  }
}
