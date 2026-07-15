/**
 * Thrown for known, deliberately-worded validation/config failures in the export/import
 * pipeline (bad zip, unsupported version, missing encryption key, etc.) — safe to persist and
 * return to the client as-is. Any other error caught during job processing is treated as
 * internal and replaced with a generic message before being persisted or returned (SEC #188);
 * full detail still reaches server-side logs via log.error.
 */
export class ExportUserFacingError extends Error {}
