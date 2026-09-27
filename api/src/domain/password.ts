import { randomBytes, scrypt as scryptCb, timingSafeEqual, ScryptOptions } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) => scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))));

const WEAK = new Set(['password1234', '123456789012', 'qwertyuiop12', 'administrator', 'letmein12345']);

// Returns a human-readable problem, or null when the password is acceptable.
export function validatePassword(pw: unknown, email = ''): string | null {
  if (typeof pw !== 'string' || pw.length < 12) return 'Password must be at least 12 characters';
  if (pw.length > 200) return 'Password is too long';
  if (new Set(pw).size < 5) return 'Password is too repetitive';
  if (pw.toLowerCase() === email.toLowerCase() || WEAK.has(pw.toLowerCase())) return 'Password is too easy to guess';
  return null;
}

// scrypt with a per-password salt; the stored string carries its own parameters so they can be raised later.
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64url');
  const key = await scrypt(pw, Buffer.from(salt, 'base64url'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(key, expected);
}

let dummy: string | undefined;
// A hash to verify against when the user doesn't exist, so "no such user" takes as long as "wrong password".
export const dummyHash = async (): Promise<string> => (dummy ??= await hashPassword('timing-equaliser-not-a-real-password'));
