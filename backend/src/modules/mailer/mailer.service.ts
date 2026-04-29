import nodemailer, { type Transporter } from "nodemailer";

import { env, isEmailConfigured } from "../../config/env.js";
import { log } from "../../logger.js";
import type { MailPayload } from "./mailer.types.js";

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) {
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS
    }
  });
  return transporter;
}

export async function sendMail(payload: MailPayload): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isEmailConfigured()) {
    return { ok: false, reason: "SMTP_NOT_CONFIGURED" };
  }

  try {
    const tx = getTransporter();
    await tx.sendMail({
      from: env.SMTP_FROM,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text
    });
    log.info(`Email sent: ${payload.subject} -> ${payload.to}`);
    return { ok: true };
  } catch (err) {
    log.warn(
      err instanceof Error
        ? `Email send failed (${payload.subject} -> ${payload.to}): ${err.message}`
        : `Email send failed (${payload.subject} -> ${payload.to})`
    );
    return { ok: false, reason: "SEND_FAILED" };
  }
}

export { isEmailConfigured };
