import type { EmailTemplate } from "../mailer.types.js";
import { layout } from "./layout.js";

interface StaffSubmissionInput {
  kind: "timesheet" | "expense";
  staffName: string;
  detail: string;
  reviewUrl: string;
}

export function renderStaffSubmissionTemplate({ kind, staffName, detail, reviewUrl }: StaffSubmissionInput): EmailTemplate {
  const label = kind === "timesheet" ? "timesheet" : "expense";
  const subject = `${staffName} submitted a ${label} for review`;

  const html = layout({
    title: subject,
    content: `
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">New ${label} to review</h1>
      <p style="margin:0 0 8px;color:#374151;line-height:1.6;">
        <strong>${staffName}</strong> submitted a ${label} for approval.
      </p>
      <p style="margin:0 0 20px;color:#4b5563;line-height:1.6;">
        ${detail}
      </p>
      <p style="margin:0;">
        <a href="${reviewUrl}" style="display:inline-block;padding:12px 18px;background:#2d6a4f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
          Review ${label}
        </a>
      </p>
    `
  });

  const text = [
    subject,
    "",
    `${staffName} submitted a ${label} for approval.`,
    detail,
    "",
    `Review: ${reviewUrl}`
  ].join("\n");

  return { subject, html, text };
}
