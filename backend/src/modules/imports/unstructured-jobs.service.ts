/**
 * Unstructured Platform Jobs API (async). Not the legacy partition SDK.
 * @see https://docs.unstructured.io — use env base URL from your account.
 */
import { env } from "../../config/env.js";

const FETCH_TIMEOUT_MS = 120_000;

function baseUrl(): string {
  return env.UNSTRUCTURED_API_URL.replace(/\/$/, "");
}

function authHeaders(): HeadersInit {
  const key = env.UNSTRUCTURED_API_KEY?.trim();
  if (!key) {
    throw new Error("UNSTRUCTURED_API_KEY is not configured");
  }
  return { "unstructured-api-key": key };
}

export type UnstructuredJobCreateResult = {
  jobId: string;
  inputFileId: string;
};

function pickJobId(body: Record<string, unknown>): string | null {
  const id = body.id ?? body.job_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function pickInputFileId(body: Record<string, unknown>): string | null {
  const ids = body.input_file_ids;
  if (Array.isArray(ids) && ids.length > 0 && typeof ids[0] === "string") {
    return ids[0]!;
  }
  const files = body.input_files;
  if (Array.isArray(files) && files.length > 0) {
    const first = files[0] as Record<string, unknown>;
    const fid = first?.id;
    if (typeof fid === "string" && fid.length > 0) {
      return fid;
    }
  }
  return null;
}

/**
 * POST /jobs/ — multipart `request_data` + `input_files`.
 */
export async function unstructuredJobsCreate(params: {
  pdfBuffer: Buffer;
  fileName: string;
  templateId: string;
}): Promise<UnstructuredJobCreateResult> {
  const url = `${baseUrl()}/jobs/`;
  const form = new FormData();
  form.append("request_data", JSON.stringify({ template_id: params.templateId }));
  const blob = new Blob([new Uint8Array(params.pdfBuffer)], { type: "application/pdf" });
  form.append("input_files", blob, params.fileName || "document.pdf");

  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: form,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Unstructured job create failed: HTTP ${res.status} ${text.slice(0, 800)}`);
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("Unstructured job create: response was not JSON");
  }
  const jobId = pickJobId(body);
  const inputFileId = pickInputFileId(body);
  if (!jobId || !inputFileId) {
    throw new Error("Unstructured job create: missing job id or input file id in response");
  }
  return { jobId, inputFileId };
}

export type UnstructuredJobStatus = {
  status: string;
};

/**
 * GET /jobs/:jobId
 */
export async function unstructuredJobsGetStatus(jobId: string): Promise<UnstructuredJobStatus> {
  const url = `${baseUrl()}/jobs/${encodeURIComponent(jobId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    signal: AbortSignal.timeout(60_000)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Unstructured job status failed: HTTP ${res.status} ${text.slice(0, 800)}`);
  }
  const body = JSON.parse(text) as Record<string, unknown>;
  const raw = body.status ?? body.state ?? "";
  const status = String(raw).trim();
  return { status };
}

/**
 * GET /jobs/:jobId/download?file_id=...
 * Returns parsed JSON (partition elements array or wrapper).
 */
export async function unstructuredJobsDownloadResult(jobId: string, inputFileId: string): Promise<unknown> {
  const url = `${baseUrl()}/jobs/${encodeURIComponent(jobId)}/download?file_id=${encodeURIComponent(inputFileId)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    signal: AbortSignal.timeout(120_000)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Unstructured job download failed: HTTP ${res.status} ${text.slice(0, 800)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Unstructured job download: response was not JSON");
  }
}

export function isUnstructuredJobComplete(status: string): boolean {
  const s = status.toUpperCase();
  return s === "COMPLETED" || s === "COMPLETE" || s === "SUCCEEDED" || s === "SUCCESS";
}

export function isUnstructuredJobFailed(status: string): boolean {
  const s = status.toUpperCase();
  return s === "FAILED" || s === "ERROR" || s === "CANCELLED" || s === "CANCELED";
}
