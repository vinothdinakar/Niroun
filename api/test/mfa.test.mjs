import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, dumpDb, HOUR } from '../test-support/helpers.mjs';
import { totpCode, stepAt, STEP_SECONDS } from '../dist/domain/totp.js';

let w;
before(async () => { w = await setup(); });
after(async () => { await w.close(); });

const post = async (path, body, cookie) => {
  const res = await fetch(w.baseUrl + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] || null };
};
const get = async (path, cookie) => {
  const res = await fetch(w.baseUrl + path, { headers: cookie ? { Cookie: cookie } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const login = (u) => post('/v1/auth/login', { email: u.email, password: u.password });
// A code for a step nobody has used yet (moving the test clock if we've run out of steps).
const code = (u, secret = u.totpSecret) => w.nextCode(u.email, secret);

test('staff: a correct password alone gets no session, no cookie, and unlocks nothing', async () => {
  for (const role of ['admin', 'reviewer']) {
    const u = await w.makeUser({ role });
    const r = await login(u);
    assert.equal(r.status, 200);
    assert.equal(r.body.needs, 'totp');
    assert.equal(r.cookie, null, 'no session cookie yet');
    assert.equal(r.body.user, undefined, 'no user details leak before the second factor');
    // the challenge is not a credential
    assert.equal((await get('/v1/auth/me', r.body.challenge)).status, 401);
    assert.equal((await post('/v1/auth/2fa/begin', { challenge: r.body.challenge })).status, 401, 'a login challenge cannot be used to enrol');
  }
});

test('staff: password + authenticator code signs in; wrong and malformed codes do not', async () => {
  const u = await w.makeUser({ role: 'admin' });
  const { body: { challenge } } = await login(u);
  for (const bad of ['000000', '12345', 'abcdef', null]) { // 4 wrong attempts: a 5th would exhaust the challenge (tested below)
    const r = await post('/v1/auth/2fa/verify', { challenge, code: bad });
    assert.equal(r.status, 401, `code ${JSON.stringify(bad)}`);
    assert.equal(r.cookie, null);
  }
  const ok = await post('/v1/auth/2fa/verify', { challenge, code: await code(u) });
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie);
  assert.equal(ok.body.user.role, 'admin');
  assert.equal(ok.body.user.mfa, 'enabled');
  assert.equal((await get('/v1/stats', ok.cookie)).status, 200);
  assert.equal((await post('/v1/auth/2fa/verify', { challenge, code: await code(u) })).status, 401, 'the challenge is single-use');
});

test('a code can only be used once, even inside its 30 second window', async () => {
  const u = await w.makeUser({ role: 'reviewer' });
  const c = await code(u);
  const first = await post('/v1/auth/2fa/verify', { challenge: (await login(u)).body.challenge, code: c });
  assert.equal(first.status, 200);
  const replay = await post('/v1/auth/2fa/verify', { challenge: (await login(u)).body.challenge, code: c });
  assert.equal(replay.status, 401, 'an observed code is worthless');
  const fresh = await post('/v1/auth/2fa/verify', { challenge: (await login(u)).body.challenge, code: await code(u) });
  assert.equal(fresh.status, 200);
});

test('brute force: a challenge dies after 5 wrong codes, and the account locks across fresh logins', async () => {
  const u = await w.makeUser({ role: 'admin' });
  const { body: { challenge } } = await login(u);
  for (let i = 0; i < 5; i++) assert.equal((await post('/v1/auth/2fa/verify', { challenge, code: String(100000 + i) })).status, 401);
  const dead = await post('/v1/auth/2fa/verify', { challenge, code: await code(u) });
  assert.equal(dead.status, 401);
  assert.equal(dead.body.error.code, 'INVALID_CHALLENGE', 'even the right code is refused once the challenge is exhausted');

  // 5 wrong codes have now been counted against the account; logging in again can't reset that
  const again = await login(u);
  const locked = await post('/v1/auth/2fa/verify', { challenge: again.body.challenge, code: await code(u) });
  assert.equal(locked.status, 429);
  w.clock.advance(16 * 60_000);
  const later = await post('/v1/auth/2fa/verify', { challenge: (await login(u)).body.challenge, code: await code(u) });
  assert.equal(later.status, 200, 'the lock lifts after 15 minutes');
});

test('challenges expire after 5 minutes', async () => {
  const u = await w.makeUser({ role: 'admin' });
  const { body: { challenge } } = await login(u);
  w.clock.advance(6 * 60_000);
  const r = await post('/v1/auth/2fa/verify', { challenge, code: await code(u) });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, 'INVALID_CHALLENGE');
});

test('recovery codes: work once each, are forgiving to type, and are counted', async () => {
  const u = await w.makeUser({ role: 'admin' });
  const [first, second] = u.recoveryCodes;

  const a = await post('/v1/auth/2fa/verify', { challenge: (await login(u)).body.challenge, code: first.toUpperCase().replace('-', ' ') });
  assert.equal(a.status, 200);
  assert.equal(a.body.usedRecoveryCode, true);
  assert.equal(a.body.recoveryCodesLeft, 2);

  const reuse = await post('/v1/auth/2fa/verify', { challenge: (await login(u)).body.challenge, code: first });
  assert.equal(reuse.status, 401, 'a recovery code is single-use');
  const b = await post('/v1/auth/2fa/verify', { challenge: (await login(u)).body.challenge, code: second });
  assert.equal(b.status, 200);
  assert.equal(b.body.recoveryCodesLeft, 1);

  const log = (await w.admin('GET', '/v1/console/audit')).entries;
  assert.equal(log.filter((e) => e.action === '2fa.recovery_used' && e.actorEmail === u.email).length, 2, 'every use is audited');
});

test('enrolment: a new staff member must set up an authenticator before they get anything', async () => {
  const email = 'newadmin@test.example';
  const inv = await w.admin('POST', '/v1/console/users', { email, name: 'New Admin', role: 'reviewer' });
  assert.ok(inv.inviteToken);
  const pw = 'Na-' + 'r7Yh3Kq9Wm2Xz5';

  const accepted = await post('/v1/auth/accept-invite', { token: inv.inviteToken, password: pw });
  assert.equal(accepted.body.needs, 'enroll');
  assert.equal(accepted.cookie, null);
  // logging in again before finishing enrolment leads to the same place: no way around it
  const relogin = await post('/v1/auth/login', { email, password: pw });
  assert.equal(relogin.body.needs, 'enroll');

  const { challenge } = accepted.body;
  assert.equal((await post('/v1/auth/2fa/confirm', { challenge, code: '123456' })).status, 400, 'confirm before begin is refused');
  const begun = (await post('/v1/auth/2fa/begin', { challenge })).body;
  assert.match(begun.secret, /^[A-Z2-7]{32}$/);
  assert.match(begun.otpauthUri, /^otpauth:\/\/totp\/Bond%3Anewadmin%40test\.example\?secret=/);

  assert.equal((await post('/v1/auth/2fa/confirm', { challenge, code: '000000' })).status, 401, 'a wrong code does not switch 2FA on');
  assert.equal((await w.app.accounts.findByEmail(email)).totp, null);

  const done = await post('/v1/auth/2fa/confirm', { challenge, code: totpCode(begun.secret, w.clock.now()) });
  assert.equal(done.status, 200);
  assert.ok(done.cookie);
  assert.equal(done.body.user.mfa, 'enabled');
  assert.equal(done.body.recoveryCodes.length, 10);
  assert.equal(new Set(done.body.recoveryCodes).size, 10);
  assert.equal((await get('/v1/auth/me', done.cookie)).status, 200);

  // from now on it's a normal two-step sign-in, and the enrolment challenge is spent
  assert.equal((await post('/v1/auth/2fa/begin', { challenge })).status, 401);
  assert.equal((await post('/v1/auth/login', { email, password: pw })).body.needs, 'totp');
  const audit = (await w.admin('GET', '/v1/console/audit')).entries;
  assert.ok(audit.some((e) => e.action === '2fa.enrolled' && e.actorEmail === email));
});

test('customers are not forced into two-factor, but can use it if it is set up', async () => {
  const org = await w.app.accounts.createOrg('Mfa Optional Inc', null);
  const plain = await w.makeUser({ role: 'owner_admin', orgId: org.id });
  const r = await login(plain);
  assert.equal(r.status, 200);
  assert.ok(r.cookie, 'a customer signs in with a password alone');
  assert.equal(r.body.user.mfa, 'off');

  const secret = 'JBSWY3DPEHPK3PXP';
  await w.app.accounts.createUser({ email: 'careful@test.example', name: 'Careful', role: 'owner_admin', orgId: org.id, password: 'Ca-' + 'w4Nf8Kp2Xv6Qz', totpSecret: secret });
  const needs = await post('/v1/auth/login', { email: 'careful@test.example', password: 'Ca-' + 'w4Nf8Kp2Xv6Qz' });
  assert.equal(needs.body.needs, 'totp', 'if a customer has enrolled, the code is enforced for them too');
  assert.equal(needs.cookie, null);
});

test('recovery codes can be regenerated, but only with a live authenticator code', async () => {
  const u = await w.makeUser({ role: 'admin' });
  const s = await u.signIn();
  const old = u.recoveryCodes[0];

  assert.equal((await post('/v1/auth/2fa/recovery-codes', { code: '000000' }, s.cookie)).status, 401);
  assert.equal((await post('/v1/auth/2fa/recovery-codes', { code: await code(u) })).status, 401, 'needs a signed-in session too');
  const fresh = await post('/v1/auth/2fa/recovery-codes', { code: await code(u) }, s.cookie);
  assert.equal(fresh.status, 200);
  assert.equal(fresh.body.recoveryCodes.length, 10);
  assert.ok(!fresh.body.recoveryCodes.includes(old));

  const withOld = await post('/v1/auth/2fa/verify', { challenge: (await login(u)).body.challenge, code: old });
  assert.equal(withOld.status, 401, 'the previous set no longer works');
  const withNew = await post('/v1/auth/2fa/verify', { challenge: (await login(u)).body.challenge, code: fresh.body.recoveryCodes[0] });
  assert.equal(withNew.status, 200);
});

test('reset: a lost phone is fixed by an admin reset, which clears 2FA and forces re-enrolment', async () => {
  const u = await w.makeUser({ role: 'reviewer' });
  const live = await u.signIn();
  const reset = await w.admin('POST', `/v1/console/users/${u.user.id}/reset`);
  assert.ok(reset.inviteToken);
  assert.equal((await get('/v1/auth/me', live.cookie)).status, 401, 'live sessions die');
  assert.equal((await w.app.accounts.findByEmail(u.email)).totp, null);
  assert.deepEqual((await w.app.accounts.findByEmail(u.email)).recovery, []);

  const accepted = await post('/v1/auth/accept-invite', { token: reset.inviteToken, password: 'Rs-' + 'p5Vc8Hn3Ty7Kd' });
  assert.equal(accepted.body.needs, 'enroll', 'the old authenticator no longer counts for anything');
  const audit = (await w.admin('GET', '/v1/console/audit')).entries;
  assert.ok(audit.some((e) => e.action === 'user.reset' && e.detail.mfaCleared === true));
});

test('a staff session that skipped two-factor is never honoured, even if forged straight into the database', async () => {
  const u = await w.makeUser({ role: 'admin' });
  const { createHash, randomBytes } = await import('node:crypto');
  const token = randomBytes(32).toString('base64url');
  const now = w.clock.now();
  const forge = (t, userId) => w.app.mongo.db.collection('sessions').insertOne({ _id: createHash('sha256').update(t).digest('hex'), userId, createdAt: now, lastSeen: now, gcAt: new Date(Date.now() + 3_600_000) }); // no mfa flag
  await forge(token, u.user.id);
  assert.equal((await get('/v1/auth/me', 'bond_session=' + token)).status, 401);
  // the same record for a customer is fine: only staff need the second factor
  const org = await w.app.accounts.createOrg('Forge Test Org', null);
  const cust = await w.makeUser({ role: 'owner_viewer', orgId: org.id });
  const token2 = randomBytes(32).toString('base64url');
  await forge(token2, cust.user.id);
  assert.equal((await get('/v1/auth/me', 'bond_session=' + token2)).status, 200);
});

test('secrets at rest: the authenticator secret is encrypted and recovery codes are only hashes', async () => {
  const u = await w.makeUser({ role: 'admin' });
  const dump = await dumpDb(w.app);
  const userDoc = await w.app.mongo.db.collection('users').findOne({ _id: u.user.id });
  assert.ok(!dump.includes(u.totpSecret), 'the base32 secret must not appear in the database');
  for (const rc of u.recoveryCodes) assert.ok(!dump.includes(rc) && !dump.includes(rc.replace('-', '')), 'recovery codes must not be stored');
  assert.match(userDoc.totp.secretEnc, /^[\w-]+\.[\w-]+\.[\w-]+$/);
  // wrong key => the sealed secret can't be opened (i.e. stealing the database alone is not enough)
  const { open } = await import('../dist/domain/totp.js');
  const { randomBytes } = await import('node:crypto');
  assert.throws(() => open(randomBytes(32), userDoc.totp.secretEnc));
});

test('the sign-in step endpoints are not a backdoor: bad challenges are rejected uniformly', async () => {
  for (const [path, body] of [['/v1/auth/2fa/verify', { code: '123456' }], ['/v1/auth/2fa/begin', {}], ['/v1/auth/2fa/confirm', { code: '123456' }]]) {
    for (const challenge of [undefined, '', 'nope', 'x'.repeat(200), { a: 1 }]) {
      const r = await post(path, { ...body, challenge });
      assert.equal(r.status, 401, `${path} with ${JSON.stringify(challenge)?.slice(0, 20)}`);
      assert.equal(r.body.error.code, 'INVALID_CHALLENGE');
    }
  }
  assert.ok(stepAt(w.clock.now()) > 0 && STEP_SECONDS === 30 && HOUR > 0);
});
