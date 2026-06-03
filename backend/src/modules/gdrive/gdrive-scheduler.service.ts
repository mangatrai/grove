import cron from "node-cron";

import { qAll, qExec, qGet } from "../../db/query.js";
import { env } from "../../config/env.js";
import { log } from "../../logger.js";
import { queueBackupJob, scheduleBackupJobProcessing } from "../export/gdrive-backup.service.js";

type SchedulerHouseholdRow = {
  household_id: string;
  backup_frequency_hours: number;
};

let schedulerStarted = false;

export function startBackupScheduler(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  // Nightly at 11 PM local time (TZ env var). Fires at wall-clock time regardless of DST.
  cron.schedule("0 23 * * *", () => { void checkAndQueueDueBackups(); }, {
    timezone: env.TZ,
  });
}

/**
 * Scans `household_gdrive_config` for households with automatic backups enabled
 * and queues a job when the last successful backup is older than the configured interval.
 */
export async function checkAndQueueDueBackups(): Promise<void> {
  const rows = await qAll<SchedulerHouseholdRow>(
    `SELECT household_id, backup_frequency_hours FROM household_gdrive_config WHERE backup_frequency_hours > 0`
  );

  for (const row of rows) {
    const householdId = row.household_id;
    const freqHours = Number(row.backup_frequency_hours);
    try {
      const inflight = await qGet<{ c: string }>(
        `SELECT 1 AS c FROM backup_job WHERE household_id = ? AND status IN ('queued', 'running') LIMIT 1`,
        householdId
      );
      if (inflight) {
        continue;
      }

      const lastComplete = await qGet<{ completed_at: string }>(
        `SELECT completed_at FROM backup_job
          WHERE household_id = ? AND status = 'complete'
          ORDER BY completed_at DESC NULLS LAST
          LIMIT 1`,
        householdId
      );

      const lastCompleteMs = lastComplete?.completed_at
        ? new Date(String(lastComplete.completed_at)).getTime()
        : 0;
      const now = Date.now();
      const periodMs = freqHours * 3600 * 1000;
      const due = now - lastCompleteMs >= periodMs;

      if (lastComplete && env.MODE === "PROD" && now - lastCompleteMs > 2 * periodMs) {
        const hoursAgo = Math.floor((now - lastCompleteMs) / 3600000);
        log.warn(
          `Backup overdue for household ${householdId}: last success was ${hoursAgo}h ago, frequency is ${freqHours}h. Instance may have been sleeping.`
        );
      }

      if (due) {
        const { jobId } = await queueBackupJob(householdId, null);
        await qExec(
          `UPDATE household_gdrive_config SET last_scheduled_backup_at = NOW() WHERE household_id = ?`,
          householdId
        );
        scheduleBackupJobProcessing(jobId, householdId);
        log.info(`Scheduler queued backup job ${jobId} for household ${householdId}`);
      }
    } catch (err: unknown) {
      log.error(
        `Backup scheduler: household ${householdId} — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
