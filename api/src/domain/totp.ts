import { createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Time-based one-time passwords (RFC 6238 / RFC 4226): HMAC-SHA1, 30-second steps, 6 digits.
// This is what Google Authenticator, Authy, 1Password and friends implement.

export const STEP_SECONDS = 30;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function toBase32(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(str: string): Buffer {
  const clean = String(str).toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newSecret = (): string => toBase32(randomBytes(20)); // 160 bits, as recommended

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[19] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export const stepAt = (ms: number): number => Math.floor(ms / 1000 / STEP_SECONDS);
export const totpCode = (secretB32: string, ms: number, digits = 6): string => hotp(fromBase32(secretB32), stepAt(ms), digits);

const safeEq = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Accepts the current step and one either side (phone clock drift). A step at or before `lastStep`
// is refused, so a code that has been used once, or observed, can never be replayed.
// Returns the matched step, or null.
export function verifyTotp(secretB32: string, code: unknown, ms: number, lastStep = -1, window = 1): number | null {
  const c = String(code ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const secret = fromBase32(secretB32);
  const now = stepAt(ms);
  let hit: number | null = null;
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (step <= lastStep) continue;
    if (safeEq(hotp(secret, step), c) && hit === null) hit = step; // no early exit: constant-ish time
  }
  return hit;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'Bond'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

// ---- recovery codes: one-time, shown once, stored only as hashes ----
const RC_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (i, l, o, 0, 1)
export function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let s = '';
  for (const b of bytes) s += RC_ALPHABET[b % RC_ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}
export const normalizeRecovery = (c: unknown): string => String(c ?? '').toLowerCase().replace(/[\s-]/g, '');

// ---- encrypting secrets at rest (AES-256-GCM) ----
export function seal(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}
export function open(key: Buffer, sealed: string): string {
  const [iv, tag, ct] = String(sealed).split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

// Key for sealing secrets: BOND_ENCRYPTION_KEY (base64, 32 bytes) if set; otherwise the given key file
// (created on first use); otherwise a throwaway key (tests).
// In production, put the key in a KMS/secret manager. It must not live beside the data.
export function loadEncryptionKey(keyFile: string | null): Buffer {
  const env = process.env.BOND_ENCRYPTION_KEY;
  if (env) {
    const k = Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('BOND_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    return k;
  }
  if (!keyFile) return randomBytes(32);
  const file = keyFile;
  if (existsSync(file)) return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  mkdirSync(dirname(file), { recursive: true });
  const k = randomBytes(32);
  writeFileSync(file, k.toString('base64'), { mode: 0o600 });
  return k;
}
