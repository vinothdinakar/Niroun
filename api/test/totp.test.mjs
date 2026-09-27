import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotp, totpCode, verifyTotp, toBase32, fromBase32, newSecret, otpauthUri, seal, open, newRecoveryCode, normalizeRecovery, stepAt } from '../dist/domain/totp.js';
import { randomBytes } from 'node:crypto';

// RFC 6238 Appendix B, HMAC-SHA1, secret "12345678901234567890", 8 digits.
const RFC_SECRET = Buffer.from('12345678901234567890');
test('TOTP matches the official RFC 6238 test vectors', () => {
  for (const [t, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']]) {
    assert.equal(hotp(RFC_SECRET, stepAt(t * 1000), 8), expected, `t=${t}`);
  }
});

test('base32 round-trips and matches the standard alphabet', () => {
  assert.equal(toBase32(RFC_SECRET), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'); // the well-known encoding of that secret
  const buf = randomBytes(20);
  assert.deepEqual(fromBase32(toBase32(buf)), buf);
  assert.deepEqual(fromBase32('gezd gnbv-gy3t qojq gezd gnbv gy3t qojq'), RFC_SECRET, 'tolerates spaces, dashes and lowercase as typed by people');
  assert.throws(() => fromBase32('not*valid'));
});

test('verify: accepts the current code and one step of clock drift, nothing more', () => {
  const secret = newSecret();
  const now = 1_700_000_000_000;
  const at = (offsetSteps) => totpCode(secret, now + offsetSteps * 30_000);
  assert.notEqual(verifyTotp(secret, at(0), now), null);
  assert.notEqual(verifyTotp(secret, at(-1), now), null);
  assert.notEqual(verifyTotp(secret, at(1), now), null);
  assert.equal(verifyTotp(secret, at(2), now), null);
  assert.equal(verifyTotp(secret, at(-2), now), null);
});

test('verify: a code can never be replayed once its step has been used', () => {
  const secret = newSecret();
  const now = 1_700_000_000_000;
  const code = totpCode(secret, now);
  const step = verifyTotp(secret, code, now);
  assert.equal(step, stepAt(now));
  assert.equal(verifyTotp(secret, code, now, step), null, 'same code again is refused');
  assert.equal(verifyTotp(secret, totpCode(secret, now - 30_000), now, step), null, 'an older code is refused too');
  assert.notEqual(verifyTotp(secret, totpCode(secret, now + 30_000), now, step), null, 'the next step is fine');
});

test('verify: rejects malformed input', () => {
  const secret = newSecret();
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34']) assert.equal(verifyTotp(secret, bad, Date.now()), null);
  assert.notEqual(verifyTotp(secret, totpCode(secret, 5e11).replace(/^(...)(...)$/, '$1 $2'), 5e11), null, 'spaces in "123 456" are fine');
});

test('otpauth URI is what authenticator apps expect', () => {
  const uri = otpauthUri('ABCDEF234567', 'ada@bond.test');
  assert.match(uri, /^otpauth:\/\/totp\/Bond%3Aada%40bond\.test\?secret=ABCDEF234567&issuer=Bond&algorithm=SHA1&digits=6&period=30$/);
});

test('sealed secrets round-trip, and are useless with the wrong key or after tampering', () => {
  const key = randomBytes(32);
  const sealed = seal(key, 'JBSWY3DPEHPK3PXP');
  assert.ok(!sealed.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(open(key, sealed), 'JBSWY3DPEHPK3PXP');
  assert.notEqual(seal(key, 'JBSWY3DPEHPK3PXP'), sealed, 'fresh IV each time');
  assert.throws(() => open(randomBytes(32), sealed));
  const parts = sealed.split('.');
  parts[2] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => open(key, parts.join('.')));
});

test('recovery codes: unambiguous alphabet, unique, and forgiving to type', () => {
  const codes = new Set(Array.from({ length: 200 }, newRecoveryCode));
  assert.equal(codes.size, 200);
  for (const c of codes) assert.match(c, /^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$/);
  assert.equal(normalizeRecovery('ABCDE-fghjk'), 'abcdefghjk');
  assert.equal(normalizeRecovery(' abcde fghjk '), 'abcdefghjk');
});
