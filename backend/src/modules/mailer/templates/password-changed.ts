import type { EmailTemplate } from "../mailer.types.js";
import { layout } from "./layout.js";

export function renderPasswordChangedTemplate(): EmailTemplate {
  const html = layout({
    title: "Your Grove password was changed",
    content: `
      <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">Password changed</h1>
      <p style="margin:0 0 12px;color:#374151;line-height:1.6;">
        Your Grove password was just changed.
      </p>
      <p style="margin:0 0 12px;color:#374151;line-height:1.6;">
        If you made this change, no action is needed.
      </p>
      <p style="margin:0;color:#b91c1c;line-height:1.6;">
        If you did not change your password, contact your household admin immediately.
      </p>
    `
  });

  const text = [
    "Your Grove password was just changed.",
    "If you made this change, no action is needed.",
    "If you did not change your password, contact your household admin immediately."
  ].join("\n");

  return {
    subject: "Your Grove password was changed",
    html,
    text
  };
}
