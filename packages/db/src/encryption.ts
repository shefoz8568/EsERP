/**
 * Phase 11 — field encryption at rest (Phase 8 hardening).
 *
 * AES-256-GCM, app-level, for Employee national ID / Iqama + bank IBAN.
 * Key comes from the `ENCRYPTION_KEY` environment variable: 64 hex chars
 * (32 bytes), generated with `openssl rand -hex 32`. Stored format:
 * `enc1:<base64(iv[12] || authTag[16] || ciphertext)>`.
 *
 * - `encrypt()` returns the `enc1:` form; empty/null stays null.
 * - `decrypt()` returns the plaintext for `enc1:` values and passes legacy
 *   plaintext values through unchanged (so rows written before Phase 11
 *   keep working until the migration script encrypts them in place).
 * - Tampered ciphertext fails authentication and throws — never silently
 *   return a wrong value.
 * - When no key is configured the encryptor is inert: `encrypt()` returns
 *   the plaintext unchanged and logs a warning once. This keeps local dev
 *   working, but production MUST set ENCRYPTION_KEY (the API refuses to
 *   claim encryption without it — see `hasKey`).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export const ENCRYPTED_PREFIX = 'enc1:';

export function isEncryptedValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

export function parseEncryptionKey(keyHex: string | undefined | null): Buffer | null {
  if (!keyHex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex.trim())) return null;
  return Buffer.from(keyHex.trim(), 'hex');
}

export class FieldEncryptor {
  private readonly key: Buffer | null;
  private warned = false;

  constructor(keyHex?: string | null) {
    this.key = parseEncryptionKey(keyHex ?? process.env.ENCRYPTION_KEY ?? null);
  }

  get hasKey(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string | null | undefined): string | null {
    if (plaintext === null || plaintext === undefined || plaintext === '') return null;
    if (isEncryptedValue(plaintext)) return plaintext; // already encrypted — idempotent
    if (!this.key) {
      if (!this.warned) {
        this.warned = true;
        console.warn('[encryption] ENCRYPTION_KEY is not set — sensitive fields are stored in plaintext. Set a 64-hex-char key for production.');
      }
      return plaintext;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENCRYPTED_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
  }

  decrypt(value: string | null | undefined): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (!isEncryptedValue(value)) return value; // legacy plaintext passthrough
    if (!this.key) throw new Error('ENCRYPTION_KEY is required to decrypt a stored value');
    const raw = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
    if (raw.length < 28) throw new Error('Stored encrypted value is malformed');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}

/** Shared singleton (reads ENCRYPTION_KEY from the environment at first use). */
let defaultEncryptor: FieldEncryptor | null = null;
export function fieldEncryptor(): FieldEncryptor {
  if (!defaultEncryptor) defaultEncryptor = new FieldEncryptor();
  return defaultEncryptor;
}
