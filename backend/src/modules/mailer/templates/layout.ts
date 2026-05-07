import { env } from "../../../config/env.js";

interface LayoutPayload {
  title: string;
  content: string;
}

export function layout({ title, content }: LayoutPayload): string {
  const publicBaseUrl = env.PUBLIC_BASE_URL?.trim() ?? "";
  const footerLink = publicBaseUrl
    ? `<div style="margin-top: 6px;"><a href="${publicBaseUrl}" style="color: #2d6a4f; text-decoration: none;">${publicBaseUrl}</a></div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f5f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:18px 24px;background:#ffffff;border-bottom:1px solid #e5e7eb;">
                <div style="font-size:18px;font-weight:700;color:#2d6a4f;">HF · Household Finance</div>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                ${content}
              </td>
            </tr>
          </table>
          <div style="max-width:600px;padding:14px 8px 0;color:#6b7280;font-size:12px;line-height:1.5;text-align:center;">
            You're receiving this because you're a member of Household Finance.
            ${footerLink}
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
