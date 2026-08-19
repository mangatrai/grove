import type { EmailTemplate } from "../mailer.types.js";
import { layout } from "./layout.js";

interface StaffApprovedInput {
  kind: "timesheet" | "expense";
  detail: string;
  portalUrl: string;
}

export function renderStaffApprovedTemplate({ kind, detail, portalUrl }: StaffApprovedInput): EmailTemplate {
  const label = kind === "timesheet" ? "timesheet" : "expense";
  const subject = `Your ${label} was approved`;

  const html = layout({
    title: subject,
    content: `
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${subject}</h1>
      <p style="margin:0 0 20px;color:#374151;line-height:1.6;">
        ${detail}
      </p>
      <p style="margin:0;">
        <a href="${portalUrl}" style="display:inline-block;padding:12px 18px;background:#2d6a4f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
          Open staff portal
        </a>
      </p>
    `
  });

  const text = [subject, "", detail, "", `Open: ${portalUrl}`].join("\n");

  return { subject, html, text };
}
