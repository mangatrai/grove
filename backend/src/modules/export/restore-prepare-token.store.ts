import fs from "node:fs";
import { randomUUID } from "node:crypto";

import { log } from "../../logger.js";
import type { HfbManifestPreview } from "./import-household-bundle.service.js";

/**
 * SEC #186: two-phase restore confirmation. /prepare validates an uploaded .hfb and stashes it
 * here; /execute consumes the token to actually run the restore. In-memory (not DB-backed like
 * password_reset_token) per owner decision — no schema change, and prepare->execute happens
 * within one UI session so loss on server restart is acceptable.
 */

const PREPARE_TOKEN_TTL_MS = 15 * 60 * 1000;

type PrepareEntry = {
  householdId: string;
  userId: string;
  filePath: string;
  manifest: HfbManifestPreview;
  expiresAt: number;
};

const prepareTokens = new Map<string, PrepareEntry>();

export function createPrepareToken(
  householdId: string,
  userId: string,
  filePath: string,
  manifest: HfbManifestPreview
): string {
  const token = randomUUID();
  prepareTokens.set(token, {
    householdId,
    userId,
    filePath,
    manifest,
    expiresAt: Date.now() + PREPARE_TOKEN_TTL_MS
  });
  return token;
}

/** Single-use: deletes the entry on any lookup attempt, matched or not. */
export function consumePrepareToken(token: string, householdId: string, userId: string): PrepareEntry | null {
  const entry = prepareTokens.get(token);
  if (!entry) return null;
  prepareTokens.delete(token);
  if (entry.expiresAt < Date.now()) return null;
  if (entry.householdId !== householdId || entry.userId !== userId) return null;
  return entry;
}

/** Lazy cleanup — deletes expired entries and their orphaned holding files. Call on route entry. */
export function sweepExpiredPrepareTokens(): void {
  const now = Date.now();
  for (const [token, entry] of prepareTokens.entries()) {
    if (entry.expiresAt < now) {
      prepareTokens.delete(token);
      fs.unlink(entry.filePath, (err) => {
        if (err && err.code !== "ENOENT") {
          log.warn("restore prepare token sweep: failed to unlink orphaned file", {
            filePath: entry.filePath,
            err: String(err)
          });
        }
      });
    }
  }
}
