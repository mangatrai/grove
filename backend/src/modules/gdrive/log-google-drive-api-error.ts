import { GaxiosError } from "gaxios";

import { log } from "../../logger.js";

/**
 * Logs Google's HTTP status and JSON error body for Drive API failures.
 * Intended for backend / LOG_FILE only — does not change API responses to clients.
 */
export function logGoogleDriveApiError(
  context: string,
  err: unknown,
  level: "warn" | "error" = "error"
): void {
  if (!(err instanceof GaxiosError)) {
    return;
  }
  const payload = {
    context,
    httpStatus: err.response?.status,
    httpStatusText: err.response?.statusText,
    responseBody: err.response?.data ?? null,
    message: err.message
  };
  if (level === "warn") {
    log.warn("Google Drive API:", payload);
  } else {
    log.error("Google Drive API:", payload);
  }
}
