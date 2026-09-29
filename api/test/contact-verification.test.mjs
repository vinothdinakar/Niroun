import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, HOUR } from '../test-support/helpers.mjs';

let w, acme;
before(async () => {
  w = await setup();
  acme = await w.app.accounts.createOrg('Contact Verify Co', null, 'business');
});
after(async () => { await w.close(); });

const mailTo = (email) => w.app.mailer.outbox.filter((m) => m.to === email);
const tokenOf = (msg) => msg.link.split('#token=')[1];
const smsTo = (phone) => w.app.sms.outbox.filter((m) => m.to === phone);
const codeOf = (msg) => msg.text.slice(0, 6);

test('email: an invited (non-signup) account starts unverified, and a clicked link proves it', async () => {
  const owner = await w.makeUser({ role: 'owner_admin', orgId: acme.id });
  const session = await owner.signIn();
  assert.equal((await session.req('GET', '/v1/auth/me')).body.user.emailVerified, false, 'not proven by anything yet');

  const sent = await session.req('POST', '/v1/auth/email/verify/send');
  assert.equal(sent.status, 200);
  const mail = mailTo(owner.email);
  assert.equal(mail.length, 1);
  assert.match(mail[0].link, /\/verify-email#token=[\w-]{20,}$/, 'the token rides in the fragment, not sent to any server');

  // Public: no session needed to use the link (it might be opened in a different browser).
  const confirm = await fetch(`${w.baseUrl}/v1/auth/email/verify/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenOf(mail[0]) }),
  });
  assert.equal(confirm.status, 200);
  assert.equal((await confirm.json()).email, owner.email);
  assert.equal((await session.req('GET', '/v1/auth/me')).body.user.emailVerified, true);

  // Single-use, and an already-verified account refuses a new link.
  const reused = await fetch(`${w.baseUrl}/v1/auth/email/verify/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokenOf(mail[0]) }),
  });
  assert.equal(reused.status, 400);
  assert.equal((await session.req('POST', '/v1/auth/email/verify/send')).status, 400);
});

test('email: an invalid or expired token is refused, and resending is rate-limited', async () => {
  const owner = await w.makeUser({ role: 'owner_admin', orgId: acme.id });
  const session = await owner.signIn();

  const bad = await fetch(`${w.baseUrl}/v1/auth/email/verify/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'not-a-real-token' }),
  });
  assert.equal(bad.status, 400);

  await session.req('POST', '/v1/auth/email/verify/send');
  const first = tokenOf(mailTo(owner.email).at(-1));
  w.clock.advance(25 * HOUR); // past the 24h expiry
  const expired = await fetch(`${w.baseUrl}/v1/auth/email/verify/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: first }),
  });
  assert.equal(expired.status, 400);

  const fresh = await owner.signIn(); // the 25h jump above also outlasted the session itself
  for (let i = 0; i < 5; i++) assert.equal((await fresh.req('POST', '/v1/auth/email/verify/send')).status, 200, `attempt ${i + 1} in a fresh window`);
  assert.equal((await fresh.req('POST', '/v1/auth/email/verify/send')).status, 429, '6th request in the window: 5/hour, resends included');
});

test('phone: add a number, receive a code by text, and confirm it — wrong codes are locked out', async () => {
  const owner = await w.makeUser({ role: 'owner_admin', orgId: acme.id });
  const session = await owner.signIn();

  assert.equal((await session.req('PUT', '/v1/auth/phone', { phone: 'not a phone number' })).status, 400);
  assert.equal((await session.req('POST', '/v1/auth/phone/verify/send')).status, 400, 'nothing to verify yet');

  const set = await session.req('PUT', '/v1/auth/phone', { phone: '+14155550123' });
  assert.equal(set.status, 200);
  assert.equal(set.body.user.phone, '+14155550123');
  assert.equal(set.body.user.phoneVerified, false);

  assert.equal((await session.req('POST', '/v1/auth/phone/verify/confirm', { code: '000000' })).status, 400, 'no code was sent yet');

  assert.equal((await session.req('POST', '/v1/auth/phone/verify/send')).status, 200);
  const text = smsTo('+14155550123').at(-1);
  assert.match(text.text, /^\d{6} is your Bond verification code/);
  const code = codeOf(text);

  assert.equal((await session.req('POST', '/v1/auth/phone/verify/confirm', { code: '999999' })).status, 400, 'wrong code');
  const confirmed = await session.req('POST', '/v1/auth/phone/verify/confirm', { code });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.user.phoneVerified, true);
  assert.equal((await session.req('GET', '/v1/auth/me')).body.user.phoneVerified, true, 'persisted');

  // Changing the number resets verification: the new one hasn't been proven.
  const changed = await session.req('PUT', '/v1/auth/phone', { phone: '+442071234567' });
  assert.equal(changed.body.user.phoneVerified, false);

  // Brute-force lockout on the confirm step (this is a 6-digit code, unlike the email link's long token).
  await session.req('POST', '/v1/auth/phone/verify/send');
  for (let i = 0; i < 5; i++) assert.equal((await session.req('POST', '/v1/auth/phone/verify/confirm', { code: '111111' })).status, 400);
  assert.equal((await session.req('POST', '/v1/auth/phone/verify/confirm', { code: '111111' })).status, 429);
});

test('phone: re-saving the same number keeps it verified; sending/confirming needs a session', async () => {
  const owner = await w.makeUser({ role: 'owner_admin', orgId: acme.id });
  const session = await owner.signIn();
  await session.req('PUT', '/v1/auth/phone', { phone: '+15005550006' });
  await session.req('POST', '/v1/auth/phone/verify/send');
  const code = codeOf(smsTo('+15005550006').at(-1));
  await session.req('POST', '/v1/auth/phone/verify/confirm', { code });

  const resaved = await session.req('PUT', '/v1/auth/phone', { phone: '+15005550006' });
  assert.equal(resaved.body.user.phoneVerified, true, 'same number, nothing to re-prove');

  assert.equal((await fetch(`${w.baseUrl}/v1/auth/phone`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"phone":"+15005550006"}' })).status, 401);
  assert.equal((await fetch(`${w.baseUrl}/v1/auth/phone/verify/send`, { method: 'POST' })).status, 401);
});
