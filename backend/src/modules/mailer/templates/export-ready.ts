import type { EmailTemplate } from "../mailer.types.js";
import { layout } from "./layout.js";

export interface ExportReadyTemplateInput {
  /** Human-readable e.g. "May 5, 2026 at 3:41 PM" */
  expiresAt: string;
  /** Null when PUBLIC_BASE_URL is not set */
  settingsUrl: string | null;
}

export function renderExportReadyTemplate({ expiresAt, settingsUrl }: ExportReadyTemplateInput): EmailTemplate {
  const expiryBlock = `
        <p style="margin:16px 0 0;color:#111827;line-height:1.6;font-size:15px;font-weight:600;">
          This file expires on ${expiresAt}. After that you'll need to start a new export.
        </p>`;

  const html =
    settingsUrl != null && settingsUrl.length > 0
      ? layout({
          title: "Your Household Finance export is ready",
          content: `
        <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">Your export is ready to download.</h1>
        <p style="margin:0 0 16px;color:#374151;line-height:1.6;">
          Your export is ready to download.
        </p>
        <p style="margin:0 0 20px;">
          <a href="${settingsUrl}" style="display:inline-block;padding:12px 18px;background:#2d6a4f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
            Download export
          </a>
        </p>
        <p style="margin:0 0 8px;color:#4b5563;line-height:1.6;font-size:14px;">
          If the button doesn't work, copy this link into your browser:
        </p>
        <p style="margin:0 0 16px;padding:10px 12px;background:#f3f4f6;border-radius:6px;word-break:break-all;font-size:13px;line-height:1.5;">
          <a href="${settingsUrl}" style="color:#2d6a4f;text-decoration:none;">${settingsUrl}</a>
        </p>
        ${expiryBlock}
      `
        })
      : layout({
          title: "Your Household Finance export is ready",
          content: `
        <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">Your export is ready to download.</h1>
        <p style="margin:0 0 16px;color:#374151;line-height:1.6;">
          Your export is ready to download.
        </p>
        <p style="margin:0 0 16px;color:#374151;line-height:1.6;">
          To download it: open the Household Finance app and go to Settings → Data and Backup.
        </p>
        ${expiryBlock}
      `
        });

  const text =
    settingsUrl != null && settingsUrl.length > 0
      ? [
          "Your Household Finance export is ready",
          "",
          "Your export is ready to download.",
          "",
          `Download export: ${settingsUrl}`,
          "",
          `This file expires on ${expiresAt}. After that you'll need to start a new export.`
        ].join("\n")
      : [
          "Your Household Finance export is ready",
          "",
          "Your export is ready to download.",
          "",
          "To download it: open the Household Finance app and go to Settings → Data & Backup.",
          "",
          `This file expires on ${expiresAt}. After that you'll need to start a new export.`
        ].join("\n");

  return {
    subject: "Your Household Finance export is ready",
    html,
    text
  };
}
