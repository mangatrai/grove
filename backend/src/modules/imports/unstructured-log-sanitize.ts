/**
 * Redact/truncate Unstructured API JSON for safe logging (no API keys here — those stay in headers).
 */
import { normalizePartitionElements } from "./unstructured-partition-summarize.js";

const BASE64ish = /^(?:[A-Za-z0-9+/]{40,}={0,2})$/;

function isProbablyBase64String(s: string): boolean {
  return s.length > 200 && BASE64ish.test(s.slice(0, 80));
}

/**
 * Deep-copy JSON-like values with string truncation and base64-ish / known heavy keys dropped.
 * Suitable for logging job create/status responses and partition arrays.
 */
export function truncateDeepForLog(value: unknown, maxStr = 900, depth = 0): unknown {
  if (depth > 14) {
    return "[max depth]";
  }
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    if (value.length > maxStr) {
      return `${value.slice(0, maxStr)}…(+${value.length - maxStr} chars)`;
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const cap = 80;
    const slice = value.slice(0, cap);
    const mapped = slice.map((x) => truncateDeepForLog(x, maxStr, depth + 1));
    if (value.length > cap) {
      return [...mapped, `…(+${value.length - cap} more items)`];
    }
    return mapped;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      const kl = k.toLowerCase();
      if (
        kl.includes("base64") ||
        kl === "image_base64" ||
        kl.includes("embedding") ||
        kl.includes("coordinates")
      ) {
        if (typeof v === "string") {
          out[k] = `[omitted string ${v.length} chars]`;
        } else if (v && typeof v === "object") {
          out[k] = "[omitted object]";
        } else {
          out[k] = v;
        }
        continue;
      }
      if (typeof v === "string" && isProbablyBase64String(v)) {
        out[k] = `[omitted probable-base64 ${v.length} chars]`;
        continue;
      }
      out[k] = truncateDeepForLog(v, maxStr, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Per-element preview for partition download (keeps logs usable; omits huge metadata). */
export function compactPartitionElementsForLog(data: unknown, textSlice = 700, htmlSlice = 2500): unknown[] {
  const elements = normalizePartitionElements(data);
  return elements.slice(0, 40).map((el, i) => {
    const e = el as {
      type?: string;
      text?: string;
      element_id?: string;
      metadata?: Record<string, unknown>;
    };
    const meta = e.metadata && typeof e.metadata === "object" ? { ...e.metadata } : undefined;
    let htmlPreview: string | undefined;
    if (meta && typeof meta.text_as_html === "string") {
      const raw = meta.text_as_html.replace(
        /data:image\/[^;]+;base64,[A-Za-z0-9+/=\s]+/gi,
        "[data:image base64 omitted]"
      );
      htmlPreview =
        raw.length > htmlSlice ? `${raw.slice(0, htmlSlice)}…(+${raw.length - htmlSlice} chars)` : raw;
      meta.text_as_html = htmlPreview;
    }
    const text =
      typeof e.text === "string"
        ? e.text.length > textSlice
          ? `${e.text.slice(0, textSlice)}…(+${e.text.length - textSlice} chars)`
          : e.text
        : undefined;
    return truncateDeepForLog(
      {
        index: i,
        type: e.type,
        element_id: e.element_id,
        text,
        metadata: meta
      },
      2000,
      6
    ) as unknown;
  });
}
