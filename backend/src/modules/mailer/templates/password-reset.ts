import type { EmailTemplate } from "../mailer.types.js";
import { layout } from "./layout.js";

interface PasswordResetTemplateInput {
  resetLink: string;
}

export function renderPasswordResetTemplate({ resetLink }: PasswordResetTemplateInput): EmailTemplate {
  const hasResetLink = /^https?:\/\//i.test(resetLink);
  const html = hasResetLink
    ? layout({
      title: "Reset your Household Finance password",
      content: `
        <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">Reset your password</h1>
        <p style="margin:0 0 16px;color:#374151;line-height:1.6;">
          We received a request to reset your Household Finance password.
        </p>
        <p style="margin:0 0 20px;">
          <a href="${resetLink}" style="display:inline-block;padding:12px 18px;background:#2d6a4f;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">
            Reset password
          </a>
        </p>
        <p style="margin:0;color:#4b5563;line-height:1.6;">
          This link expires in 1 hour. If you didn't request this, ignore this email.
        </p>
      `
    })
    : layout({
      title: "Reset your Household Finance password",
      content: `
        <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">Reset your password</h1>
        <p style="margin:0 0 16px;color:#374151;line-height:1.6;">
          We received a request to reset your Household Finance password.
        </p>
        <p style="margin:0 0 8px;color:#4b5563;line-height:1.6;">
          To reset your password, open the Household Finance app and go to
          Sign In → Forgot password, then enter the token below:
        </p>
        <p style="margin:0 0 16px;padding:10px 12px;background:#f3f4f6;border-radius:6px;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:14px;">
          ${resetLink}
        </p>
        <p style="margin:0;color:#4b5563;line-height:1.6;">
          This token expires in 1 hour. If you didn't request this, ignore this email.
        </p>
      `
    });

  const text = hasResetLink
    ? [
      "Reset your Household Finance password",
      "",
      "We received a request to reset your Household Finance password.",
      `Reset link: ${resetLink}`,
      "",
      "This link expires in 1 hour. If you didn't request this, ignore this email."
    ].join("\n")
    : [
      "Reset your Household Finance password",
      "",
      "We received a request to reset your Household Finance password.",
      "To reset your password, open the Household Finance app and go to Sign In -> Forgot password, then enter the token below:",
      resetLink,
      "",
      "This token expires in 1 hour. If you didn't request this, ignore this email."
    ].join("\n");

  return {
    subject: "Reset your Household Finance password",
    html,
    text
  };
}
