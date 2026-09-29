import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setup, testApp, dumpDb } from '../test-support/helpers.mjs';

let w, n = 0;
before(async () => { w = await setup(); });
after(async () => { await w.close(); });

const call = async (base, method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (res.headers.get('set-cookie') || '').split(';')[0] || null };
};
const post = (path, body) => call(w.baseUrl, 'POST', path, body);
const fresh = () => w.clock.advance(61 * 60_000); // a new rate-limit window
const valid = (over = {}) => {
  n++;
  return { name: 'Pat Owner', email: `pat${n}@widgets${n}.test`, company: `Widgets ${n} Ltd`, password: 'Pt-' + randomBytes(12).toString('base64url'), acceptTerms: true, ...over };
};
const mailTo = (email) => w.app.mailer.outbox.filter((m) => m.to === email);
const tokenOf = (msg) => msg.link.split('#token=')[1];
const signUpAndGetToken = async (form) => {
  assert.equal((await post('/v1/signup', form)).status, 202);
  return tokenOf(mailTo(form.email.trim().toLowerCase()).at(-1));
};

test('signup is closed unless explicitly opened, and the dev mailbox never exists by default', async () => {
  const closed = await testApp();
  const port = await closed.listen(0);
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await call(base, 'GET', '/v1/health')).body.signup, 'closed');
    const r = await call(base, 'POST', '/v1/signup', valid());
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'SIGNUP_CLOSED');
    assert.equal((await call(base, 'POST', '/v1/signup/verify', { token: 'x' })).status, 403);
    assert.equal((await call(base, 'GET', '/v1/dev/outbox')).status, 404);
  } finally {
    await closed.close();
  }
  assert.equal((await call(w.baseUrl, 'GET', '/v1/health')).body.signup, 'open');
});

test('happy path: nothing exists until the email link is used, then a company and its first admin appear', async () => {
  fresh();
  const form = valid();
  const r = await post('/v1/signup', form);
  assert.equal(r.status, 202);
  assert.deepEqual(Object.keys(r.body).sort(), ['message', 'ok'], 'the response carries no token or user data');

  assert.equal(await w.app.accounts.findByEmail(form.email), null, 'no account yet');
  assert.ok(!(await w.app.accounts.listOrgs()).some((o) => o.name === form.company), 'no company yet');
  assert.equal((await post('/v1/auth/login', { email: form.email, password: form.password })).status, 401, 'cannot sign in before verifying');

  const mail = mailTo(form.email);
  assert.equal(mail.length, 1);
  assert.match(mail[0].link, /^http:\/\/localhost:\d+\/verify#token=[\w-]{20,}$/, 'the link points at the configured URL, with the token in the fragment');

  const v = await post('/v1/signup/verify', { token: tokenOf(mail[0]) });
  assert.equal(v.status, 200);
  assert.equal(v.body.orgName, form.company);
  assert.equal(v.cookie, null, 'verifying does not sign anyone in');

  const s = await w.signIn(form.email, form.password);
  assert.equal(s.user.role, 'owner_admin');
  assert.equal(s.user.orgName, form.company);
  assert.equal(s.user.mfa, 'off');
  assert.equal(s.user.emailVerified, true, 'clicking this link already proved the email; no separate step needed');
  assert.equal((await s.req('GET', '/v1/stats')).status, 403, 'a new customer sees nothing of Bond internals');

  const org = (await w.app.accounts.listOrgs()).find((o) => o.name === form.company);
  assert.equal(org.createdVia, 'signup');
  assert.equal(org.verification, 0, 'new companies start unverified');
  assert.equal((await post('/v1/signup/verify', { token: tokenOf(mail[0]) })).status, 400, 'the link is single-use');

  // and they can immediately connect their first agent
  const enr = await s.req('POST', '/v1/console/enrollments', { label: 'first' });
  assert.equal(enr.status, 201);
  const agent = await w.agent('SignupBot', undefined, { enrollmentCode: enr.body.code });
  const me = await agent.me();
  assert.equal(me.owner, form.company);
  assert.equal(me.orgId, org.id);
});

test('no account enumeration: an existing email gets exactly the same answer as a new one', async () => {
  fresh();
  const existing = await w.makeUser({ role: 'owner_viewer', orgId: (await w.app.accounts.createOrg('Enum Test Org', null)).id });
  const pendingCount = () => w.app.mongo.db.collection('signups').countDocuments();
  const before = await pendingCount();

  const forExisting = await post('/v1/signup', valid({ email: existing.email.toUpperCase() }));
  const forNew = await post('/v1/signup', valid());
  assert.equal(forExisting.status, forNew.status);
  assert.deepEqual(forExisting.body, forNew.body);

  assert.equal(await pendingCount(), before + 1, 'only the genuinely new address got a pending signup');
  const note = mailTo(existing.email).at(-1);
  assert.match(note.subject, /already have a Bond account/);
  assert.ok(!note.link.includes('verify'), 'the existing owner is told to sign in, not handed a way to create anything');
});

test('validation: weak passwords, missing terms, bad emails and duplicate companies are refused with clear codes', async () => {
  fresh();
  const err = async (over) => (await post('/v1/signup', valid(over))).body.error?.code;
  assert.equal(await err({ password: 'short' }), 'WEAK_PASSWORD');
  assert.equal(await err({ password: 'aaaaaaaaaaaaaaaa' }), 'WEAK_PASSWORD');
  assert.equal(await err({ acceptTerms: false }), 'TERMS_REQUIRED');
  assert.equal(await err({ acceptTerms: 'true' }), 'TERMS_REQUIRED', 'must be a real boolean');
  fresh();
  assert.equal(await err({ email: 'not-an-email' }), 'INVALID_EMAIL');
  assert.equal(await err({ company: 'X' }), 'INVALID_COMPANY');
  assert.equal(await err({ name: '   ' }), 'INVALID_NAME');
  fresh();
  const org = await w.app.accounts.createOrg('Acme Dynamics', null);
  const clash = await post('/v1/signup', valid({ company: 'ACME  dynamics.' }));
  assert.equal(clash.status, 409, 'differently-spelled copies of an existing company name are refused');
  assert.equal(clash.body.error.code, 'ORG_EXISTS');
  assert.ok(org);
});

test('a person can never choose their own role or organization', async () => {
  fresh();
  const other = await w.app.accounts.createOrg('Somebody Else Inc', null);
  const form = valid({ role: 'admin', orgId: other.id, verification: 2 });
  const token = await signUpAndGetToken(form);
  await post('/v1/signup/verify', { token });
  const s = await w.signIn(form.email, form.password);
  assert.equal(s.user.role, 'owner_admin', 'never staff');
  assert.notEqual(s.user.orgId, other.id, 'never joined an existing company');
  assert.equal((await w.app.accounts.listOrgs()).find((o) => o.id === s.user.orgId).verification, 0);
});

test('links expire after 24 hours, and resending kills the previous link', async () => {
  fresh();
  const a = valid();
  const old = await signUpAndGetToken(a);
  w.clock.advance(25 * 3_600_000);
  assert.equal((await post('/v1/signup/verify', { token: old })).body.error.code, 'INVALID_VERIFICATION');

  fresh();
  const b = valid();
  const first = await signUpAndGetToken(b);
  assert.equal((await post('/v1/signup/resend', { email: b.email })).status, 202);
  const second = tokenOf(mailTo(b.email).at(-1));
  assert.notEqual(first, second);
  assert.equal((await post('/v1/signup/verify', { token: first })).status, 400, 'the earlier link is dead');
  assert.equal((await post('/v1/signup/verify', { token: second })).status, 200);

  const unknown = await post('/v1/signup/resend', { email: 'ghost@nowhere.test' });
  assert.equal(unknown.status, 202, 'same answer for an address that never signed up');
  assert.equal(mailTo('ghost@nowhere.test').length, 0);
});

test('abuse: signups are rate limited per address and per source, and a honeypot catches bots', async () => {
  fresh();
  const same = valid();
  for (let i = 0; i < 3; i++) assert.equal((await post('/v1/signup', same)).status, 202);
  const fourth = await post('/v1/signup', same);
  assert.equal(fourth.status, 429, 'the same address can only be tried 3 times an hour');

  fresh();
  for (let i = 0; i < 5; i++) assert.equal((await post('/v1/signup', valid())).status, 202);
  assert.equal((await post('/v1/signup', valid())).status, 429, 'one source can only do 5 signups an hour');
  fresh();
  assert.equal((await post('/v1/signup', valid())).status, 202, 'and the window resets');

  fresh();
  const bot = valid({ website: 'http://spam.example' });
  const pending = await w.app.mongo.db.collection('signups').countDocuments();
  const sent = w.app.mailer.outbox.length;
  assert.equal((await post('/v1/signup', bot)).status, 202, 'bots are told it worked');
  assert.equal(await w.app.mongo.db.collection('signups').countDocuments(), pending, 'but nothing was stored');
  assert.equal(w.app.mailer.outbox.length, sent, 'and nothing was sent');
});

test('individual signup: a clashing personal org name is disambiguated instead of refused', async () => {
  fresh();
  const sameName = `Jordan Individual ${++n}`;
  const a = valid({ company: sameName, accountType: 'individual' });
  const b = valid({ company: sameName, accountType: 'individual' });

  const ra = await post('/v1/signup', a);
  assert.equal(ra.status, 202);
  const rb = await post('/v1/signup', b);
  assert.equal(rb.status, 202, 'the second individual is never told the name is taken');

  const va = await post('/v1/signup/verify', { token: tokenOf(mailTo(a.email).at(-1)) });
  assert.equal(va.status, 200);
  assert.equal(va.body.orgName, sameName, 'the first one keeps the plain name');

  const vb = await post('/v1/signup/verify', { token: tokenOf(mailTo(b.email).at(-1)) });
  assert.equal(vb.status, 200);
  assert.notEqual(vb.body.orgName, sameName, 'the second one is silently disambiguated');
  assert.ok(vb.body.orgName.startsWith(sameName), 'still recognisably the same name');

  const s = await w.signIn(b.email, b.password);
  assert.equal(s.user.orgName, vb.body.orgName);
  const orgA = (await w.app.accounts.listOrgs()).find((o) => o.name === sameName);
  const orgB = (await w.app.accounts.listOrgs()).find((o) => o.id === s.user.orgId);
  assert.equal(orgA.accountType, 'individual');
  assert.equal(orgB.accountType, 'individual');
});

test('a plain business signup gets accountType "business" on its org', async () => {
  fresh();
  const form = valid();
  await post('/v1/signup/verify', { token: await signUpAndGetToken(form) });
  const org = (await w.app.accounts.listOrgs()).find((o) => o.name === form.company);
  assert.equal(org.accountType, 'business');
});

test('staff can create an org of either type, and correct it afterwards', async () => {
  fresh();
  const created = await w.admin('POST', '/v1/console/orgs', { name: `Correctable ${++n}`, accountType: 'individual' });
  assert.equal(created.accountType, 'individual');

  const defaulted = await w.admin('POST', '/v1/console/orgs', { name: `Defaulted ${n}` });
  assert.equal(defaulted.accountType, 'business', 'staff-created orgs default to business when unspecified');

  const corrected = await w.admin('POST', `/v1/console/orgs/${created.id}/account-type`, { accountType: 'business' });
  assert.equal(corrected.accountType, 'business');
  assert.equal(corrected.verification, 0, 'changing the type never touches verification');

  const bad = await w.admin('POST', `/v1/console/orgs/${created.id}/account-type`, { accountType: 'nonsense' });
  assert.equal(bad.error?.code, 'INVALID_ACCOUNT_TYPE');
});

test('two people racing for one company name: the first to verify wins, the second is told clearly', async () => {
  fresh();
  const company = `Race ${++n} Holdings`;
  const a = valid({ company });
  const b = valid({ company });
  const ta = await signUpAndGetToken(a);
  const tb = await signUpAndGetToken(b);
  assert.equal((await post('/v1/signup/verify', { token: ta })).status, 200);
  const late = await post('/v1/signup/verify', { token: tb });
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, 'ORG_EXISTS');
  assert.equal(await w.app.accounts.findByEmail(b.email), null, 'the loser got nothing');
});

test('verification is a staff decision, and every agent of the company inherits it, now and later', async () => {
  fresh();
  const form = valid();
  await post('/v1/signup/verify', { token: await signUpAndGetToken(form) });
  const owner = await w.signIn(form.email, form.password);
  const orgId = owner.user.orgId;
  const enroll = async (name) => w.agent(name, undefined, { enrollmentCode: (await owner.req('POST', '/v1/console/enrollments', {})).body.code });

  const first = await enroll('InheritA');
  assert.equal((await first.score()).verification, 0);

  assert.equal((await owner.req('POST', `/v1/console/orgs/${orgId}/verify`, { level: 2 })).status, 403, 'a company cannot verify itself');
  const r = await w.admin('POST', `/v1/console/orgs/${orgId}/verify`, { level: 2 });
  assert.equal(r.verification, 2);
  assert.equal((await first.score()).verification, 2, 'existing agents are upgraded');
  const later = await enroll('InheritB');
  assert.equal((await later.score()).verification, 2, 'new agents start verified');

  const ledger = (await w.admin('GET', `/v1/agents/${first.agentId}/ledger`)).entries;
  assert.ok(ledger.some((e) => e.type === 'verification_set' && e.data.level === 2));
  const audit = (await w.admin('GET', '/v1/console/audit')).entries;
  assert.ok(audit.some((e) => e.action === 'org.verify' && e.target === orgId));
  assert.ok(audit.some((e) => e.action === 'signup.verified' && e.actorEmail === form.email.toLowerCase()));
});

test('emails are normalised, and secrets are stored only as hashes', async () => {
  fresh();
  const form = valid({ email: `  MixedCase${++n}@Example.TEST ` });
  const token = await signUpAndGetToken(form);
  const dump = await dumpDb(w.app);
  assert.ok(!dump.includes(form.password), 'password is never stored in the clear, even while pending');
  assert.ok(!dump.includes(token), 'the verification token is stored only as a hash');
  const pending = await w.app.mongo.db.collection('signups').findOne({ company: form.company });
  assert.match(pending.passwordHash, /^scrypt\$/);
  assert.equal(pending.email, form.email.trim().toLowerCase());

  await post('/v1/signup/verify', { token });
  assert.equal(await w.app.mongo.db.collection('signups').countDocuments({ company: form.company }), 0, 'the pending record is gone once used');
  const user = await w.app.accounts.findByEmail(form.email);
  assert.equal(user.email, form.email.trim().toLowerCase());
  assert.equal(user.termsVersion, 'preview-1');
  assert.ok(user.termsAcceptedAt);
  assert.equal((await post('/v1/auth/login', { email: form.email.toUpperCase(), password: form.password })).status, 200, 'sign-in is case-insensitive too');
});

test('demo mailbox: emails are readable at /v1/dev/outbox, newest first, only when enabled', async () => {
  fresh();
  const a = valid();
  const b = valid();
  await post('/v1/signup', a);
  await post('/v1/signup', b);
  const box = (await call(w.baseUrl, 'GET', '/v1/dev/outbox')).body.emails;
  assert.equal(box[0].to, b.email.toLowerCase());
  assert.equal(box[1].to, a.email.toLowerCase());
  assert.ok(box[0].link.includes('/verify#token='));
});
