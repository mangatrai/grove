import { describe, expect, it, vi } from "vitest";

import {
  consumePrepareToken,
  createPrepareToken,
  sweepExpiredPrepareTokens
} from "../src/modules/export/restore-prepare-token.store.js";
import type { HfbManifestPreview } from "../src/modules/export/import-household-bundle.service.js";

const FAKE_MANIFEST: HfbManifestPreview = {
  exportVersion: 4,
  exportedAt: "2026-01-01T00:00:00.000Z",
  encrypted: false,
  scope: "household",
  format: "hfb-zip-v1",
  tables: {},
  totalRows: 0
};

describe("restore-prepare-token.store (SEC #186)", () => {
  it("create then consume with matching household/user returns the entry", () => {
    const token = createPrepareToken("household-a", "user-a", "/tmp/fake.hfb", FAKE_MANIFEST);
    const entry = consumePrepareToken(token, "household-a", "user-a");
    expect(entry).not.toBeNull();
    expect(entry?.filePath).toBe("/tmp/fake.hfb");
    expect(entry?.manifest).toEqual(FAKE_MANIFEST);
  });

  it("is single-use: consuming the same token twice returns null the second time", () => {
    const token = createPrepareToken("household-b", "user-b", "/tmp/fake2.hfb", FAKE_MANIFEST);
    expect(consumePrepareToken(token, "household-b", "user-b")).not.toBeNull();
    expect(consumePrepareToken(token, "household-b", "user-b")).toBeNull();
  });

  it("consuming with the wrong householdId or userId returns null", () => {
    const token = createPrepareToken("household-c", "user-c", "/tmp/fake3.hfb", FAKE_MANIFEST);
    expect(consumePrepareToken(token, "household-wrong", "user-c")).toBeNull();
  });

  it("consuming a token that was never created returns null", () => {
    expect(consumePrepareToken("never-existed", "household-d", "user-d")).toBeNull();
  });

  it("an expired token is rejected by consume even before a sweep runs", () => {
    vi.useFakeTimers();
    try {
      const token = createPrepareToken("household-e", "user-e", "/tmp/fake4.hfb", FAKE_MANIFEST);
      vi.advanceTimersByTime(16 * 60 * 1000);
      expect(consumePrepareToken(token, "household-e", "user-e")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweepExpiredPrepareTokens does not throw when the map is empty or has only fresh entries", () => {
    createPrepareToken("household-f", "user-f", "/tmp/fake5.hfb", FAKE_MANIFEST);
    expect(() => sweepExpiredPrepareTokens()).not.toThrow();
  });
});
