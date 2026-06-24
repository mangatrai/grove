import cron from "node-cron";

import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { runFamilyAgentForAllHouseholds } from "./family-agent.service.js";

export function startFamilyAgentScheduler(): void {
  // Sunday ~7pm — light weekly preview (always sends)
  // Note: "preview" helps households spot obvious conflicts heading into Monday.
  cron.schedule("0 19 * * 0", () => {
    log.info("family-agent: Sunday preview run triggered");
    void runFamilyAgentForAllHouseholds("sunday_preview");
  }, { timezone: env.TZ });

  // Monday ~7am — full weekly digest with duty assignments (always sends)
  cron.schedule("3 7 * * 1", () => {
    log.info("family-agent: Monday digest run triggered");
    void runFamilyAgentForAllHouseholds("monday_digest");
  }, { timezone: env.TZ });

  // Tue–Sat ~6:30am — delta check after the 6am GCal sync window
  // Only sends if a new conflict is detected since the last run.
  cron.schedule("32 6 * * 2-6", () => {
    log.info("family-agent: daily delta run triggered");
    void runFamilyAgentForAllHouseholds("daily_delta");
  }, { timezone: env.TZ });

  log.info("family-agent scheduler started", {
    timezone: env.TZ,
    jobs: ["Sunday 7:00pm preview", "Monday 7:03am digest", "Tue-Sat 6:32am delta"],
  });
}
