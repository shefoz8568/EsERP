import { describe, expect, it } from 'vitest';
import { FieldEncryptor, isEncryptedValue, parseEncryptionKey } from '@eserp/db';
import { maskSensitive } from '@eserp/shared';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('FieldEncryptor (AES-256-GCM)', () => {
  it('round-trips national ID and IBAN', () => {
    const enc = new FieldEncryptor(KEY);
    expect(enc.hasKey).toBe(true);
    for (const value of ['1012345678', 'SA0380000000608012345678', '2345678901']) {
      const cipher = enc.encrypt(value);
      expect(cipher).not.toBe(value);
      expect(isEncryptedValue(cipher)).toBe(true);
      expect(enc.decrypt(cipher)).toBe(value);
    }
  });

  it('is non-deterministic (fresh IV per value) but decrypts both', () => {
    const enc = new FieldEncryptor(KEY);
    const a = enc.encrypt('1012345678');
    const b = enc.encrypt('1012345678');
    expect(a).not.toBe(b);
    expect(enc.decrypt(a)).toBe('1012345678');
    expect(enc.decrypt(b)).toBe('1012345678');
  });

  it('rejects tampered ciphertext (GCM authentication)', () => {
    const enc = new FieldEncryptor(KEY);
    const cipher = enc.encrypt('1012345678') as string;
    const tampered = `${cipher.slice(0, -4)}AAAA`;
    expect(() => enc.decrypt(tampered)).toThrow();
  });

  it('passes legacy plaintext through on decrypt and is idempotent on encrypt', () => {
    const enc = new FieldEncryptor(KEY);
    expect(enc.decrypt('1012345678')).toBe('1012345678');
    const cipher = enc.encrypt('1012345678') as string;
    expect(enc.encrypt(cipher)).toBe(cipher);
  });

  it('returns null for null/empty and throws on decrypt without a key', () => {
    const enc = new FieldEncryptor(KEY);
    expect(enc.encrypt(null)).toBeNull();
    expect(enc.encrypt('')).toBeNull();
    expect(enc.decrypt(null)).toBeNull();
    const noKey = new FieldEncryptor('');
    expect(noKey.hasKey).toBe(false);
    expect(noKey.encrypt('1012345678')).toBe('1012345678'); // inert without a key
    expect(() => noKey.decrypt(enc.encrypt('1012345678'))).toThrow(/ENCRYPTION_KEY/);
  });

  it('rejects malformed keys', () => {
    expect(parseEncryptionKey('short')).toBeNull();
    expect(parseEncryptionKey('zz'.repeat(32))).toBeNull();
    expect(parseEncryptionKey(KEY)).not.toBeNull();
  });

  it('masking never reveals more than the last 4 characters', () => {
    const enc = new FieldEncryptor(KEY);
    const cipher = enc.encrypt('1012345678') as string;
    const masked = maskSensitive(enc.decrypt(cipher));
    expect(masked).toBe('****5678');
    expect(masked).not.toContain('101234');
    expect(maskSensitive(cipher)).toBe(`****${cipher.slice(-4)}`); // ciphertext itself is also masked, never shown raw
  });
});
