import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, testApp, dumpDb, fundedOrder, HOUR, DAY } from '../test-support/helpers.mjs';
import { BondError } from '../sdk/index.js';
import { totpCode } from '../dist/domain/totp.js';

let w, acme, northwind;
before(async () => {
  w = await setup();
  acme = await w.app.accounts.createOrg('Acme Corp', null);
  northwind = await w.app.accounts.createOrg('Northwind', null);
});
after(async () => { await w.close(); });

const raw = (method, path, { cookie, headers = {}, body } = {}) =>
  fetch(w.baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });

// An agent enrolled into an org by that org's admin.
async function enrolled(ownerSession, name) {
  const r = await ownerSession.req('POST', '/v1/console/enrollments', { label: name });
  assert.equal(r.status, 201);
  return w.agent(name, undefined, { enrollmentCode: r.body.code });
}
// A dispute the arbiter can't settle by itself, so it waits for a human.
async function reviewableDispute(buyer, seller) {
  const { tx, spec } = await fundedOrder(buyer, seller);
  await seller.deliver(tx.id, spec);
  const { dispute } = await buyer.dispute(tx.id, 'nothing arrived');
  assert.equal(dispute.status, 'needs_review');
  return { tx, dispute };
}

test('sign-in: hardened session cookie, generic failure messages, no secrets in responses', async () => {
  const u = await w.makeUser({ role: 'owner_viewer', orgId: acme.id }); // customers sign in with a password alone (staff: see mfa.test.js)
  const res = await raw('POST', '/v1/auth/login', { body: { email: u.email, password: u.password } });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^bond_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const text = JSON.stringify(await res.json());
  assert.ok(!text.includes('scrypt') && !text.includes('passwordHash'));

  const wrong = await raw('POST', '/v1/auth/login', { body: { email: u.email, password: 'definitely-not-it-1' } });
  const unknown = await raw('POST', '/v1/auth/login', { body: { email: 'nobody@test.example', password: 'definitely-not-it-1' } });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual((await wrong.json()).error, (await unknown.json()).error, 'no way to tell "wrong password" from "no such user"');
});

test('sign-in: repeated failures lock the account, even against the correct password', async () => {
  const u = await w.makeUser({ role: 'owner_viewer', orgId: acme.id });
  for (let i = 0; i < 5; i++) {
    assert.equal((await raw('POST', '/v1/auth/login', { body: { email: u.email, password: 'wrong-password-' + i } })).status, 401);
  }
  const locked = await raw('POST', '/v1/auth/login', { body: { email: u.email, password: u.password } });
  assert.equal(locked.status, 429);
  w.clock.advance(16 * 60_000);
  assert.equal((await raw('POST', '/v1/auth/login', { body: { email: u.email, password: u.password } })).status, 200);
});

test('dashboard data is no longer public', async () => {
  for (const p of ['/v1/stats', '/v1/agents', '/v1/transactions', '/v1/disputes', '/v1/agents/agt_x/ledger', '/v1/pricing/preview?seller=x&amountCents=100', '/v1/console/overview']) {
    assert.equal((await raw('GET', p)).status, 401, p);
  }
});

test('agents can look up reputation but only read their own deals', async () => {
  const a = await w.agent('LookupA');
  const b = await w.agent('LookupB');
  const c = await w.agent('LookupC');
  const { tx } = await fundedOrder(a, b);
  assert.equal((await c.score(a.agentId)).id, a.agentId, 'reputation is a public good between agents');
  assert.equal((await a.transaction(tx.id)).id, tx.id);
  assert.equal((await b.transaction(tx.id)).id, tx.id);
  await assert.rejects(() => c.transaction(tx.id), (e) => e instanceof BondError && e.status === 404);
});

test('roles: each role can do exactly what it should', async () => {
  const reviewer = await (await w.makeUser({ role: 'reviewer' })).signIn();
  const viewer = await (await w.makeUser({ role: 'owner_viewer', orgId: acme.id })).signIn();
  const ownerAdmin = await (await w.makeUser({ role: 'owner_admin', orgId: acme.id })).signIn();
  const some = await w.agent('RoleTarget');

  const codes = async (session, calls) => Promise.all(calls.map(([m, p, b]) => session.req(m, p, b).then((r) => r.status)));
  const staffOnly = [
    ['GET', '/v1/stats'], ['POST', '/v1/console/sweep'], ['GET', '/v1/console/audit'],
    ['POST', '/v1/console/orgs', { name: 'Nope Inc' }], ['GET', '/v1/console/users'],
    ['POST', `/v1/console/agents/${some.agentId}/verify`, { level: 2 }],
  ];

  // reviewer: reads stats and resolves disputes, but can't verify, sweep, or manage people
  assert.deepEqual(await codes(reviewer, staffOnly), [200, 403, 403, 403, 403, 403]);

  // owner admin: none of the staff-only capabilities
  assert.deepEqual(await codes(ownerAdmin, staffOnly.filter(([, p]) => p !== '/v1/console/users')), [403, 403, 403, 403, 403]);

  // owner viewer: can look, can't touch anything
  assert.equal((await viewer.req('GET', '/v1/console/overview')).status, 200);
  assert.deepEqual(await codes(viewer, [
    ['POST', '/v1/console/enrollments', {}], ['GET', '/v1/console/users'],
    ['POST', '/v1/console/users', { email: 'x@test.example', name: 'X', role: 'owner_viewer' }],
    ['GET', '/v1/stats'],
  ]), [403, 403, 403, 403]);

  // reviewer resolves a dispute; it lands in the audit log with their identity
  const buyer = await w.agent('RvBuyer');
  const seller = await w.agent('RvSeller');
  const { dispute } = await reviewableDispute(buyer, seller);
  assert.equal((await viewer.req('POST', `/v1/console/disputes/${dispute.id}/resolve`, { verdict: 'seller_fault' })).status, 403);
  assert.equal((await ownerAdmin.req('POST', `/v1/console/disputes/${dispute.id}/resolve`, { verdict: 'seller_fault' })).status, 403);
  const done = await reviewer.req('POST', `/v1/console/disputes/${dispute.id}/resolve`, { verdict: 'seller_fault', note: 'confirmed' });
  assert.equal(done.status, 200);
  assert.equal(done.body.reviewedBy, reviewer.user.email);
  const audit = { body: await w.admin('GET', '/v1/console/audit') };
  assert.ok(audit.body.entries.some((e) => e.action === 'dispute.resolve' && e.actorEmail === reviewer.user.email));
});

test('isolation: a customer sees only their own company\'s agents, deals, disputes and audit trail', async () => {
  const acmeAdmin = await (await w.makeUser({ role: 'owner_admin', orgId: acme.id })).signIn();
  const nwAdmin = await (await w.makeUser({ role: 'owner_admin', orgId: northwind.id })).signIn();
  const a1 = await enrolled(acmeAdmin, 'IsoAcmeBot');
  const n1 = await enrolled(nwAdmin, 'IsoNorthwindBot');
  const ext = await w.agent('IsoExternalSeller');

  const { tx: acmeTx } = await fundedOrder(a1, ext);
  const { tx: nwTx } = await fundedOrder(n1, ext);
  const { dispute: nwDispute } = await reviewableDispute(n1, await w.agent('IsoOtherSeller'));

  const list = (await acmeAdmin.req('GET', '/v1/transactions')).body.transactions;
  assert.ok(list.some((t) => t.id === acmeTx.id));
  assert.ok(!list.some((t) => t.id === nwTx.id), "Acme must not see Northwind's deal");
  assert.equal((await acmeAdmin.req('GET', `/v1/transactions/${nwTx.id}`)).status, 404);
  assert.equal((await acmeAdmin.req('GET', `/v1/agents/${n1.agentId}/ledger`)).status, 404);
  assert.equal((await acmeAdmin.req('GET', `/v1/console/agents/${n1.agentId}`)).status, 404);
  assert.equal((await acmeAdmin.req('GET', `/v1/agents/${a1.agentId}/ledger`)).status, 200);

  const disputes = (await acmeAdmin.req('GET', '/v1/disputes')).body.disputes;
  assert.ok(!disputes.some((d) => d.id === nwDispute.id));
  assert.ok((await nwAdmin.req('GET', '/v1/disputes')).body.disputes.some((d) => d.id === nwDispute.id));

  // scope is AND'ed in before search/filter, not after: searching for Northwind's own deal/dispute from an
  // Acme session finds nothing, it doesn't leak through the new query params
  const crossSearch = (await acmeAdmin.req('GET', '/v1/transactions?search=IsoNorthwindBot')).body;
  assert.equal(crossSearch.total, 0);
  const crossDisputeSearch = (await acmeAdmin.req('GET', '/v1/disputes?search=IsoNorthwindBot')).body;
  assert.equal(crossDisputeSearch.total, 0);

  // the overview counts only what this customer is allowed to see
  const ov = (await acmeAdmin.req('GET', '/v1/console/overview')).body;
  const acmeAgents = (await acmeAdmin.req('GET', '/v1/agents')).body.agents.filter((a) => a.orgId === acme.id);
  assert.equal(ov.agents, acmeAgents.length);
  assert.equal(ov.transactions, list.length);
  assert.ok(!acmeAgents.some((a) => a.id === n1.agentId));

  // the reputation directory itself stays visible: you need it to pick counterparties
  assert.ok((await acmeAdmin.req('GET', '/v1/agents')).body.agents.some((a) => a.id === n1.agentId));

  // the premium/payout trend is scoped the same way: only what this customer's own agents paid
  assert.ok(acmeTx.premiumCents > 0, 'test setup: the funded order should have a premium to find');
  const trend = (await acmeAdmin.req('GET', '/v1/trends')).body;
  const totalPremium = trend.reduce((sum, p) => sum + p.premiumCents, 0);
  assert.equal(totalPremium, acmeTx.premiumCents, "Acme's trend must total only their own premium, not Northwind's");
});

test('enrollment: codes link an agent to its owner, once, and can\'t be spoofed', async () => {
  const owner = await (await w.makeUser({ role: 'owner_admin', orgId: acme.id })).signIn();
  const r = await owner.req('POST', '/v1/console/enrollments', { label: 'x', orgId: northwind.id });
  assert.equal(r.status, 201);
  assert.equal(r.body.orgId, acme.id, "an owner admin can only enroll into their own org, whatever they ask for");

  const agent = await w.agent('Enrolled', undefined, { enrollmentCode: r.body.code });
  const me = await agent.me();
  assert.equal(me.orgId, acme.id);
  assert.equal(me.owner, 'Acme Corp', 'owner comes from the organisation, not the agent\'s own claim');

  await assert.rejects(() => w.agent('Reuse', undefined, { enrollmentCode: r.body.code }), (e) => e.code === 'INVALID_ENROLLMENT');
  await assert.rejects(() => w.agent('Guess', undefined, { enrollmentCode: 'enr_' + 'A'.repeat(24) }), (e) => e.code === 'INVALID_ENROLLMENT');

  const late = (await owner.req('POST', '/v1/console/enrollments', {})).body.code;
  w.clock.advance(25 * HOUR);
  await assert.rejects(() => w.agent('Late', undefined, { enrollmentCode: late }), (e) => e.code === 'INVALID_ENROLLMENT');
});

test('mandate: once an owner org has an agent, only the owner can change its limits', async () => {
  const acmeAdmin = await (await w.makeUser({ role: 'owner_admin', orgId: acme.id })).signIn();
  const acmeViewer = await (await w.makeUser({ role: 'owner_viewer', orgId: acme.id })).signIn();
  const nwAdmin = await (await w.makeUser({ role: 'owner_admin', orgId: northwind.id })).signIn();
  const bot = await enrolled(acmeAdmin, 'MandateBot');
  const seller = await w.agent('MandateSeller');

  await assert.rejects(() => bot.setPolicy({ perTxLimitCents: 99_999_999 }), (e) => e.code === 'POLICY_LOCKED');
  const free = await w.agent('Unlinked');
  assert.equal((await free.setPolicy({ perTxLimitCents: 12_345 })).policy.perTxLimitCents, 12_345);

  assert.equal((await nwAdmin.req('PUT', `/v1/console/agents/${bot.agentId}/policy`, { perTxLimitCents: 1 })).status, 404, "another company can't even see it");
  assert.equal((await acmeViewer.req('PUT', `/v1/console/agents/${bot.agentId}/policy`, { perTxLimitCents: 1 })).status, 403);
  const ok = await acmeAdmin.req('PUT', `/v1/console/agents/${bot.agentId}/policy`, { perTxLimitCents: 20_000, allowedCategories: ['data'] });
  assert.equal(ok.status, 200);

  await assert.rejects(
    () => bot.purchase({ counterparty: seller.agentId, spec: 'x', priceCents: 50_000, category: 'data' }),
    (e) => e.codes?.includes('POLICY_PER_TX_LIMIT'),
  );
  const ledger = (await w.admin('GET', `/v1/agents/${bot.agentId}/ledger`)).entries;
  assert.ok(ledger.some((e) => e.type === 'policy_updated' && e.data.by));
});

test('kill switch: a suspended agent can read but can\'t transact; resuming restores it', async () => {
  const owner = await (await w.makeUser({ role: 'owner_admin', orgId: acme.id })).signIn();
  const bot = await enrolled(owner, 'SuspendBot');
  const seller = await w.agent('SuspendSeller');
  const q = { counterparty: seller.agentId, amountCents: 1000, category: 'data' };

  assert.equal((await bot.quote(q)).decision, 'approved');
  assert.equal((await owner.req('POST', `/v1/console/agents/${bot.agentId}/status`, { status: 'suspended' })).status, 200);
  await assert.rejects(() => bot.quote(q), (e) => e instanceof BondError && e.code === 'AGENT_SUSPENDED');
  assert.equal((await bot.score()).status, 'suspended', 'reads still work');
  await owner.req('POST', `/v1/console/agents/${bot.agentId}/status`, { status: 'active' });
  assert.equal((await bot.quote(q)).decision, 'approved');
});

test('invites: people set their own password from a one-time link; nobody is handed a password', async () => {
  const admin = await w.adminUser.signIn();
  const email = 'newhire@test.example';
  const inv = await admin.req('POST', '/v1/console/users', { email, name: 'New Hire', role: 'owner_viewer', orgId: acme.id });
  assert.equal(inv.status, 201);
  assert.ok(inv.body.inviteToken);
  assert.equal(inv.body.user.pendingInvite, true);
  assert.equal((await raw('POST', '/v1/auth/login', { body: { email, password: 'anything-at-all-123' } })).status, 401);

  const weak = await raw('POST', '/v1/auth/accept-invite', { body: { token: inv.body.inviteToken, password: 'short' } });
  assert.equal((await weak.json()).error.code, 'WEAK_PASSWORD');

  const pw = 'Nh-' + 'x9Kq2Lm7Rt4Vb8Zc';
  const ok = await raw('POST', '/v1/auth/accept-invite', { body: { token: inv.body.inviteToken, password: pw } });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await raw('GET', '/v1/auth/me', { cookie })).status, 200);
  assert.equal((await raw('POST', '/v1/auth/accept-invite', { body: { token: inv.body.inviteToken, password: pw } })).status, 400, 'token is single-use');
  assert.equal((await raw('POST', '/v1/console/users', { body: { email: 'dup@test.example', name: 'D', role: 'admin' } })).status, 401);
  assert.equal((await admin.req('POST', '/v1/console/users', { email, name: 'Dup', role: 'owner_viewer', orgId: acme.id })).status, 409);

  const stale = (await admin.req('POST', '/v1/console/users', { email: 'stale@test.example', name: 'Stale', role: 'owner_viewer', orgId: acme.id })).body.inviteToken;
  w.clock.advance(8 * DAY);
  assert.equal((await raw('POST', '/v1/auth/accept-invite', { body: { token: stale, password: pw } })).status, 400, 'invites expire after 7 days');
});

test('team management: owner admins can only manage their own company', async () => {
  const acmeAdmin = await (await w.makeUser({ role: 'owner_admin', orgId: acme.id })).signIn();
  const staffMember = await w.makeUser({ role: 'reviewer' });
  const nwMember = await w.makeUser({ role: 'owner_viewer', orgId: northwind.id });
  const mine = await w.makeUser({ role: 'owner_viewer', orgId: acme.id });

  assert.equal((await acmeAdmin.req('POST', '/v1/console/users', { email: 'boss@test.example', name: 'B', role: 'admin' })).status, 403, 'cannot mint staff');
  const forced = await acmeAdmin.req('POST', '/v1/console/users', { email: 'colleague@test.example', name: 'C', role: 'owner_viewer', orgId: northwind.id });
  assert.equal(forced.status, 201);
  assert.equal(forced.body.user.orgId, acme.id, 'org comes from the inviter, not the request');

  const visible = (await acmeAdmin.req('GET', '/v1/console/users')).body.users;
  assert.ok(visible.every((u) => u.orgId === acme.id));
  assert.equal((await acmeAdmin.req('POST', `/v1/console/users/${staffMember.user.id}/disable`)).status, 404);
  assert.equal((await acmeAdmin.req('POST', `/v1/console/users/${nwMember.user.id}/reset`)).status, 404);
  assert.equal((await acmeAdmin.req('POST', `/v1/console/users/${acmeAdmin.user.id}/disable`)).status, 400, 'no self-lockout');

  // disabling takes effect immediately, including for a live session
  const theirs = await mine.signIn();
  assert.equal((await theirs.req('GET', '/v1/auth/me')).status, 200);
  assert.equal((await acmeAdmin.req('POST', `/v1/console/users/${mine.user.id}/disable`)).status, 200);
  assert.equal((await theirs.req('GET', '/v1/auth/me')).status, 401);
  assert.equal((await raw('POST', '/v1/auth/login', { body: { email: mine.email, password: mine.password } })).status, 401);
  await acmeAdmin.req('POST', `/v1/console/users/${mine.user.id}/enable`);
  assert.equal((await raw('POST', '/v1/auth/login', { body: { email: mine.email, password: mine.password } })).status, 200);

  // reset: old password and sessions die, a new one-time link is issued
  const live = await mine.signIn();
  const reset = await acmeAdmin.req('POST', `/v1/console/users/${mine.user.id}/reset`);
  assert.ok(reset.body.inviteToken);
  assert.equal((await live.req('GET', '/v1/auth/me')).status, 401);
  assert.equal((await raw('POST', '/v1/auth/login', { body: { email: mine.email, password: mine.password } })).status, 401);
});

test('sessions: idle timeout, logout, and password change all end sessions for real', async () => {
  const u = await w.makeUser({ role: 'reviewer' });

  const idle = await u.signIn();
  assert.equal((await idle.req('GET', '/v1/auth/me')).status, 200);
  w.clock.advance(3 * HOUR);
  assert.equal((await idle.req('GET', '/v1/auth/me')).status, 401);

  const s1 = await u.signIn();
  const oldCookie = s1.cookie;
  await s1.req('POST', '/v1/auth/logout');
  assert.equal((await raw('GET', '/v1/auth/me', { cookie: oldCookie })).status, 401, 'the token is dead server-side, not just deleted from the browser');

  const a = await u.signIn();
  const b = await u.signIn();
  const newPw = 'Changed-' + 'pW8vQ3nX5tY';
  assert.equal((await a.req('POST', '/v1/auth/change-password', { current: 'wrong-current-password', next: newPw })).status, 401);
  assert.equal((await a.req('POST', '/v1/auth/change-password', { current: u.password, next: 'short' })).status, 400);
  assert.equal((await a.req('POST', '/v1/auth/change-password', { current: u.password, next: newPw })).status, 200);
  assert.equal((await a.req('GET', '/v1/auth/me')).status, 200, 'this device stays signed in');
  assert.equal((await b.req('GET', '/v1/auth/me')).status, 401, 'every other device is signed out');
  assert.equal((await raw('POST', '/v1/auth/login', { body: { email: u.email, password: u.password } })).status, 401);
  assert.equal((await raw('POST', '/v1/auth/login', { body: { email: u.email, password: newPw } })).status, 200);
});

test('CSRF: cross-origin and non-JSON writes with a session cookie are refused', async () => {
  const s = await (await w.makeUser({ role: 'admin' })).signIn();
  const host = new URL(w.baseUrl).host;
  const write = (headers) => raw('POST', '/v1/console/orgs', { cookie: s.cookie, headers, body: { name: 'Csrf Test Org ' + Math.random() } });

  const evil = await write({ Origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal((await evil.json()).error.code, 'BAD_ORIGIN');
  assert.equal((await write({ 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await write({ Origin: 'http://' + host })).status, 201, 'same-origin still works');
});

test('secrets at rest: passwords are hashed; session tokens, invites and enrollment codes are stored only as hashes', async () => {
  const pw = 'Rest-' + 'aB3dE5fG7hJ9';
  const u = await w.makeUser({ role: 'reviewer' });
  await w.app.accounts.createUser({ email: 'rest@test.example', name: 'Rest', role: 'reviewer', password: pw });
  const session = await u.signIn();
  const owner = await (await w.makeUser({ role: 'owner_admin', orgId: acme.id })).signIn();
  const code = (await owner.req('POST', '/v1/console/enrollments', {})).body.code;
  const invite = (await w.admin('POST', '/v1/console/users', { email: 'inv-rest@test.example', name: 'I', role: 'owner_viewer', orgId: acme.id })).inviteToken;

  const dump = await dumpDb(w.app);
  for (const [what, secret] of [['password', pw], ['user password', u.password], ['session token', session.cookie.split('=')[1]], ['enrollment code', code], ['invite token', invite]]) {
    assert.ok(!dump.includes(secret), `${what} must not be stored in plaintext`);
  }
  const stored = await w.app.mongo.db.collection('users').find().toArray();
  assert.ok(stored.every((x) => !x.passwordHash || x.passwordHash.startsWith('scrypt$')));
});

test('first run: a one-time link creates the first admin (who must set up two-factor), then the door closes', async () => {
  const solo = await testApp();
  const port = await solo.listen(0);
  const call = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie') };
  };
  try {
    const token = await solo.accounts.bootstrapAdmin('first@test.example');
    assert.ok(token);
    const accepted = await call('/v1/auth/accept-invite', { token, password: 'First-' + 'kL4mN6pQ8rS' });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.needs, 'enroll', 'a staff account gets no session until two-factor is set up');
    assert.equal(accepted.cookie, null);

    const { secret } = (await call('/v1/auth/2fa/begin', { challenge: accepted.body.challenge })).body;
    const done = await call('/v1/auth/2fa/confirm', { challenge: accepted.body.challenge, code: totpCode(secret, solo.options.clock.now()) });
    assert.equal(done.status, 200);
    assert.equal(done.body.user.role, 'admin');
    assert.equal(done.body.recoveryCodes.length, 10);
    assert.ok(done.cookie);
    assert.equal(await solo.accounts.bootstrapAdmin('someone-else@test.example'), null, 'no second bootstrap once an admin exists');
  } finally {
    await solo.close();
  }
});
