import type { EmailTemplate } from "../mailer.types.js";
import { layout } from "./layout.js";

interface MemberInviteInput {
  resetLink: string;
}

export function renderMemberInviteTemplate({ resetLink }: MemberInviteInput): EmailTemplate {
  const html = layout({
    title: "You've been invited to Household Finance",
    content: `
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">You're invited</h1>
      <p style="margin:0 0 16px;color:#374151;line-height:1.6;">
        You've been added to Household Finance. Click below to set up your password.
      </p>
      <p style="margin:0 0 20px;">
        <a href="${resetLink}" style="display:inline-block;padding:12px 18px;background:#2d6a4f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
          Set your password
        </a>
      </p>
      <p style="margin:0;color:#4b5563;line-height:1.6;">
        This link expires in 24 hours. Set your password to activate your account.
      </p>
    `
  });

  const text = [
    "You've been invited to Household Finance",
    "",
    "You've been added to Household Finance. Click below to set up your password.",
    `Set your password: ${resetLink}`,
    "",
    "This link expires in 24 hours. Set your password to activate your account."
  ].join("\n");

  return {
    subject: "You've been invited to Household Finance",
    html,
    text
  };
}
