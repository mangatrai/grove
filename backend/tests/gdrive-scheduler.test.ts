import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "../src/config/env.js";
import { log } from "../src/logger.js";
import * as gdriveBackup from "../src/modules/export/gdrive-backup.service.js";
import { checkAndQueueDueBackups } from "../src/modules/gdrive/gdrive-scheduler.service.js";
import { sqlStmt } from "./pg-stmt.js";

const HOUSEHOLD_ID = "10000000-0000-0000-0000-000000000001";
const OWNER_USER_ID = "20000000-0000-0000-0000-000000000001";

async function insertGdriveConfig(freq: number): Promise<void> {
  await sqlStmt(
    `INSERT INTO oauth_integrations
      (provider, household_id, user_id, refresh_token, folder_id, folder_name, connected_by_user_id, last_verified_at, last_error,
       backup_frequency_hours, backup_retention_count, last_scheduled_backup_at)
     VALUES ('google_drive', ?, NULL, ?, 'fld', 'F', ?, NOW(), NULL, ?, 7, NULL)
     ON CONFLICT (household_id, provider) WHERE user_id IS NULL DO UPDATE SET
       refresh_token = EXCLUDED.refresh_token,
       folder_id = EXCLUDED.folder_id,
       folder_name = EXCLUDED.folder_name,
       connected_by_user_id = EXCLUDED.connected_by_user_id,
       backup_frequency_hours = EXCLUDED.backup_frequency_hours,
       backup_retention_count = EXCLUDED.backup_retention_count,
       last_scheduled_backup_at = NULL`
  ).run(HOUSEHOLD_ID, "mock-refresh-token", OWNER_USER_ID, freq);
}

describe("gdrive backup scheduler", () => {
  const scheduleSpy = vi.spyOn(gdriveBackup, "scheduleBackupJobProcessing").mockImplementation(() => {});

  beforeAll(async () => {
    await sqlStmt("DELETE FROM backup_job WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").run(HOUSEHOLD_ID);
  });

  afterAll(async () => {
    scheduleSpy.mockRestore();
    await sqlStmt("DELETE FROM backup_job WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").run(HOUSEHOLD_ID);
  });

  beforeEach(async () => {
    await sqlStmt("DELETE FROM backup_job WHERE household_id = ?").run(HOUSEHOLD_ID);
    await sqlStmt("DELETE FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").run(HOUSEHOLD_ID);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes without queuing when no households have scheduler enabled", async () => {
    await checkAndQueueDueBackups();
    const n = await sqlStmt("SELECT COUNT(*)::int AS c FROM backup_job WHERE household_id = ?").get(HOUSEHOLD_ID);
    expect(n?.c ?? 0).toBe(0);
  });

  it("skips household when backup_frequency_hours is 0", async () => {
    await insertGdriveConfig(0);
    await checkAndQueueDueBackups();
    const n = await sqlStmt("SELECT COUNT(*)::int AS c FROM backup_job WHERE household_id = ?").get(HOUSEHOLD_ID);
    expect(n?.c ?? 0).toBe(0);
  });

  it("queues when last complete backup is older than the interval (25h / 24h)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    await insertGdriveConfig(24);
    await sqlStmt(
      `INSERT INTO backup_job (id, household_id, status, drive_file_id, drive_file_name, size_bytes, error_text, triggered_by_user_id, created_at, completed_at)
       VALUES (?, ?, 'complete', 'f1', 'a.hfb', 100, NULL, ?, NOW(), ?)`
    ).run(
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001",
      HOUSEHOLD_ID,
      OWNER_USER_ID,
      "2026-05-02T11:00:00.000Z"
    );

    await checkAndQueueDueBackups();

    const row = await sqlStmt(
      `SELECT triggered_by_user_id FROM backup_job WHERE household_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1`
    ).get(HOUSEHOLD_ID, "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb001");
    expect(row?.triggered_by_user_id).toBeNull();

    const cfg = await sqlStmt("SELECT last_scheduled_backup_at FROM oauth_integrations WHERE household_id = ? AND provider = 'google_drive' AND user_id IS NULL").get(
      HOUSEHOLD_ID
    );
    expect(cfg?.last_scheduled_backup_at).toBeTruthy();
  });

  it("does not queue when last complete is within the interval (12h / 24h)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    await insertGdriveConfig(24);
    await sqlStmt(
      `INSERT INTO backup_job (id, household_id, status, drive_file_id, drive_file_name, size_bytes, error_text, triggered_by_user_id, created_at, completed_at)
       VALUES (?, ?, 'complete', 'f1', 'a.hfb', 100, NULL, ?, NOW(), ?)`
    ).run(
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb002",
      HOUSEHOLD_ID,
      OWNER_USER_ID,
      "2026-05-03T00:00:00.000Z"
    );

    await checkAndQueueDueBackups();
    const n = await sqlStmt("SELECT COUNT(*)::int AS c FROM backup_job WHERE household_id = ?").get(HOUSEHOLD_ID);
    expect(n?.c ?? 0).toBe(1);
  });

  it("does not queue a second job when one is already queued or running", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    await insertGdriveConfig(24);
    await sqlStmt(
      `INSERT INTO backup_job (id, household_id, status, created_at) VALUES (?, ?, 'queued', NOW())`
    ).run("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb003", HOUSEHOLD_ID);

    await checkAndQueueDueBackups();
    const n = await sqlStmt("SELECT COUNT(*)::int AS c FROM backup_job WHERE household_id = ?").get(HOUSEHOLD_ID);
    expect(n?.c ?? 0).toBe(1);
  });

  it("queues immediately when no completed backup has ever existed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    await insertGdriveConfig(24);
    await checkAndQueueDueBackups();
    const row = await sqlStmt(
      `SELECT triggered_by_user_id, status FROM backup_job WHERE household_id = ? LIMIT 1`
    ).get(HOUSEHOLD_ID);
    expect(row?.status).toBe("queued");
    expect(row?.triggered_by_user_id).toBeNull();
  });

  it("logs staleness warning in PROD when last success is beyond 2× interval", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-03T12:00:00.000Z"));
    const warnSpy = vi.spyOn(log, "warn").mockImplementation(() => {});
    const prevMode = env.MODE;
    Object.assign(env, { MODE: "PROD" });
    try {
      await insertGdriveConfig(24);
      await sqlStmt(
        `INSERT INTO backup_job (id, household_id, status, drive_file_id, drive_file_name, size_bytes, error_text, triggered_by_user_id, created_at, completed_at)
         VALUES (?, ?, 'complete', 'f1', 'a.hfb', 100, NULL, ?, NOW(), ?)`
      ).run(
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbb004",
        HOUSEHOLD_ID,
        OWNER_USER_ID,
        "2026-05-01T10:00:00.000Z"
      );

      await checkAndQueueDueBackups();

      expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("Backup overdue"))).toBe(true);
    } finally {
      Object.assign(env, { MODE: prevMode });
      warnSpy.mockRestore();
    }
  });
});
