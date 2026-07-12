import crypto from "node:crypto";

import { ExportUserFacingError } from "./export-errors.js";

const BACKUP_MAGIC = Buffer.from("HFB1", "ascii");
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER_LENGTH = BACKUP_MAGIC.length + IV_LENGTH + AUTH_TAG_LENGTH;

function parseKey(keyHex: string): Buffer {
  return Buffer.from(keyHex, "hex");
}

export function isEncryptedBackup(data: Buffer): boolean {
  return data.length >= BACKUP_MAGIC.length && data.subarray(0, BACKUP_MAGIC.length).toString("ascii") === "HFB1";
}

export function encryptBackup(data: Buffer, keyHex: string): Buffer {
  const key = parseKey(keyHex);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([BACKUP_MAGIC, iv, authTag, ciphertext]);
}

export function decryptBackup(data: Buffer, keyHex: string): Buffer {
  if (!isEncryptedBackup(data) || data.length < HEADER_LENGTH) {
    throw new ExportUserFacingError("Backup decryption failed — verify that BACKUP_ENCRYPTION_KEY matches the key used when this backup was created.");
  }
  const key = parseKey(keyHex);
  const iv = data.subarray(BACKUP_MAGIC.length, BACKUP_MAGIC.length + IV_LENGTH);
  const authTag = data.subarray(BACKUP_MAGIC.length + IV_LENGTH, HEADER_LENGTH);
  const ciphertext = data.subarray(HEADER_LENGTH);
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new ExportUserFacingError("Backup decryption failed — verify that BACKUP_ENCRYPTION_KEY matches the key used when this backup was created.");
  }
}
