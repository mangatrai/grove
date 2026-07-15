/**
 * Import session lifecycle (Epic 2.1).
 * Single source of truth for valid transitions; routes and services must use this module only.
 */
export type ImportSessionStatus =
  | "created"
  | "processing"
  | "review"
  | "finalized"
  | "failed";

const transitions: Record<ImportSessionStatus, ImportSessionStatus[]> = {
  created: ["processing", "failed"],
  processing: ["review", "failed"],
  review: ["finalized", "failed"],
  failed: [],
  finalized: []
};

export function isValidSessionTransition(
  from: ImportSessionStatus,
  to: ImportSessionStatus
): boolean {
  return (transitions[from] ?? []).includes(to);
}

/** Session accepts new file uploads only in these states. */
export function sessionAcceptsFileUploads(status: ImportSessionStatus): boolean {
  return status === "created" || status === "processing";
}
