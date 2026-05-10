import { createHash } from "node:crypto";
import crypto from "node:crypto";

import { env } from "../../config/env.js";

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function dobKey(): Buffer {
  return createHash("sha256")
    .update(`household-finance:dob:${env.JWT_SECRET}`)
    .digest();
}

/** Encrypts a YYYY-MM-DD string. Returns base64(iv[12] || authTag[16] || ciphertext). */
export function encryptDob(dob: string): string {
  const key = dobKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(dob, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Decrypts a value produced by encryptDob. Returns null on any failure. */
export function decryptDob(stored: string): string | null {
  try {
    const buf = Buffer.from(stored, "base64");
    if (buf.length < IV_LENGTH + TAG_LENGTH + 1) return null;
    const key = dobKey();
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Computes current age from a YYYY-MM-DD string. Returns null if invalid. */
export function computeAgeFromDob(dob: string): number | null {
  const birth = new Date(`${dob}T12:00:00.000Z`);
  if (isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - birth.getUTCFullYear();
  const m = today.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && today.getUTCDate() < birth.getUTCDate())) age--;
  return age >= 0 && age <= 150 ? age : null;
}
