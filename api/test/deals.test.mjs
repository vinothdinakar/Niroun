import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, fundedOrder, DAY, HOUR } from '../test-support/helpers.mjs';

// Filters, search, paging and CSV export on the deals/disputes/agents list endpoints.

let w, acmeAdminUser, acmeAdmin, buyer, sellerA, sellerB;
before(async () => {
  w = await setup();
  const acme = await w.app.accounts.createOrg('Acme Corp', null);
  acmeAdminUser = await w.makeUser({ role: 'owner_admin', orgId: acme.id });
  acmeAdmin = await acmeAdminUser.signIn();

  const enroll = async (name) => {
    const r = await acmeAdmin.req('POST', '/v1/console/enrollments', { label: name });
    return w.agent(name, undefined, { enrollmentCode: r.body.code });
  };
  buyer = await enroll('FilterBuyer');
  sellerA = await w.agent('FilterSellerA');
  sellerB = await w.agent('FilterSellerB');

  // Three funded deals: two categories, two sellers, so category/status/search filters all have something to bite on.
  await fundedOrder(buyer, sellerA, { category: 'data', priceCents: 4000 });
  await fundedOrder(buyer, sellerA, { category: 'services', priceCents: 6000 });
  await fundedOrder(buyer, sellerB, { category: 'data', priceCents: 3000 });
});
after(async () => { await w.close(); });

const raw = (method, path, { cookie, headers = {} } = {}) =>
  fetch(w.baseUrl + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });

// ---------- deals ----------

test('deals list: category and status filters narrow the result, and total reflects the filtered count', async () => {
  const dataOnly = (await acmeAdmin.req('GET', '/v1/transactions?category=data')).body;
  assert.equal(dataOnly.total, 2);
  assert.ok(dataOnly.transactions.every((t) => t.category === 'data'));

  const funded = (await acmeAdmin.req('GET', '/v1/transactions?status=funded')).body;
  assert.equal(funded.total, 3);
  assert.ok(funded.transactions.every((t) => t.status === 'funded'));

  // a status nothing matches returns zero rows, not an error
  const none = (await acmeAdmin.req('GET', '/v1/transactions?status=fulfilled')).body;
  assert.equal(none.total, 0);
  assert.deepEqual(none.transactions, []);
});

test('deals list: search matches by counterparty agent name and by transaction id', async () => {
  const byName = (await acmeAdmin.req('GET', '/v1/transactions?search=FilterSellerB')).body;
  assert.equal(byName.total, 1);
  assert.equal(byName.transactions[0].sellerName, 'FilterSellerB');

  const byId = (await acmeAdmin.req('GET', `/v1/transactions?search=${byName.transactions[0].id}`)).body;
  assert.ok(byId.transactions.some((t) => t.id === byName.transactions[0].id));
});

test('deals list: pages are disjoint and total is stable across pages', async () => {
  const p1 = (await acmeAdmin.req('GET', '/v1/transactions?pageSize=2&page=1')).body;
  const p2 = (await acmeAdmin.req('GET', '/v1/transactions?pageSize=2&page=2')).body;
  assert.equal(p1.total, p2.total);
  assert.equal(p1.transactions.length, 2);
  const ids1 = new Set(p1.transactions.map((t) => t.id));
  assert.ok(p2.transactions.every((t) => !ids1.has(t.id)), 'page 2 must not repeat page 1\'s rows');
});

test('deals export: CSV headers, filtered row count, and paging params are ignored', async () => {
  const res = await raw('GET', '/v1/transactions/export?category=data', { cookie: acmeAdmin.cookie });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const lines = (await res.text()).trim().split('\r\n');
  assert.equal(lines[0].split(',')[0], 'id');
  assert.equal(lines.length - 1, 2, 'header + the two data-category deals');

  // page=1&pageSize=1 would normally return one row; export must ignore that and return everything matching
  const allText = await (await raw('GET', '/v1/transactions/export?page=1&pageSize=1', { cookie: acmeAdmin.cookie })).text();
  assert.equal(allText.trim().split('\r\n').length - 1, 3);
});

// ---------- disputes ----------

test('disputes list: status filter, search, and total; export mirrors the same filter', async () => {
  const { tx, spec } = await fundedOrder(buyer, sellerA, { category: 'data', priceCents: 7000 });
  await sellerA.deliver(tx.id, spec);
  const { dispute } = await buyer.dispute(tx.id, 'nothing arrived');
  assert.equal(dispute.status, 'needs_review'); // an ambiguous case, per the arbiter's own rules

  const needsReview = (await acmeAdmin.req('GET', '/v1/disputes?status=needs_review')).body;
  assert.equal(needsReview.total, 1);
  assert.equal(needsReview.disputes[0].id, dispute.id);

  const bySeller = (await acmeAdmin.req('GET', '/v1/disputes?search=FilterSellerA')).body;
  assert.ok(bySeller.disputes.some((d) => d.id === dispute.id));

  const resolved = (await acmeAdmin.req('GET', '/v1/disputes?status=resolved')).body;
  assert.equal(resolved.total, 0);

  const res = await raw('GET', '/v1/disputes/export?status=needs_review', { cookie: acmeAdmin.cookie });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const lines = (await res.text()).trim().split('\r\n');
  assert.equal(lines.length - 1, 1);
});

// ---------- agents ----------

test('agents list: search, status and tier filters compose against the scored (not raw DB) order, and export mirrors them', async () => {
  const suspended = await w.agent('FilterSuspendedAgent');
  await w.admin('POST', `/v1/console/agents/${suspended.agentId}/status`, { status: 'suspended' });

  const byName = (await acmeAdmin.req('GET', '/v1/agents?search=FilterSuspendedAgent')).body;
  assert.equal(byName.total, 1);
  assert.equal(byName.agents[0].id, suspended.agentId);

  const suspendedOnly = (await acmeAdmin.req('GET', '/v1/agents?status=suspended')).body;
  assert.ok(suspendedOnly.agents.every((a) => a.status === 'suspended'));
  assert.ok(suspendedOnly.agents.some((a) => a.id === suspended.agentId));

  // a fresh agent with no outcomes is always tier NR (fewer than 3 outcomes)
  const nrTier = (await acmeAdmin.req('GET', '/v1/agents?tier=NR&search=FilterSuspendedAgent')).body;
  assert.equal(nrTier.total, 1);
  const wrongTier = (await acmeAdmin.req('GET', '/v1/agents?tier=A&search=FilterSuspendedAgent')).body;
  assert.equal(wrongTier.total, 0);

  const res = await raw('GET', '/v1/agents/export?search=FilterSuspendedAgent', { cookie: acmeAdmin.cookie });
  assert.equal(res.status, 200);
  const lines = (await res.text()).trim().split('\r\n');
  assert.equal(lines.length - 1, 1);
});

// ---------- self-service dispute (console, no agent signature) ----------

test('console dispute: the buyer org\'s own owner can open one for their own agent, marked openedBy in the ledger', async () => {
  const { tx } = await fundedOrder(buyer, sellerA, { category: 'data', priceCents: 9000 });
  w.clock.advance(DAY + HOUR); // past the delivery deadline, same rule the agent path enforces
  acmeAdmin = await acmeAdminUser.signIn(); // sessions expire when idle; the clock jump above stales the old one

  const r = await acmeAdmin.req('POST', `/v1/console/transactions/${tx.id}/disputes`, { reason: 'never showed up' });
  assert.equal(r.status, 200);
  assert.equal(r.body.dispute.verdict, 'seller_fault'); // same arbiter, same evidence as the agent-signed path
  assert.equal(r.body.transaction.status, 'resolved_seller_fault');

  const ledger = await w.admin('GET', `/v1/agents/${buyer.agentId}/ledger`);
  const entry = ledger.entries.find((e) => e.type === 'dispute_opened' && e.data.disputeId === r.body.dispute.id);
  assert.equal(entry.data.openedBy, acmeAdmin.user.email, 'must be marked as human-opened, distinct from an agent-signed dispute');
});

test('console dispute: another org cannot open one for someone else\'s deal (404, not 403 — existence stays hidden)', async () => {
  const { tx } = await fundedOrder(buyer, sellerA, { category: 'data', priceCents: 5000 });
  w.clock.advance(DAY + HOUR);

  const northwind = await w.app.accounts.createOrg('Northwind', null);
  const nwAdmin = await (await w.makeUser({ role: 'owner_admin', orgId: northwind.id })).signIn();
  const r = await nwAdmin.req('POST', `/v1/console/transactions/${tx.id}/disputes`, { reason: 'not mine to dispute' });
  assert.equal(r.status, 404);
});

test('console dispute: staff can open one for any org\'s deal', async () => {
  const { tx } = await fundedOrder(buyer, sellerA, { category: 'data', priceCents: 6000 });
  w.clock.advance(DAY + HOUR);

  const staff = await w.adminUser.signIn();
  const r = await staff.req('POST', `/v1/console/transactions/${tx.id}/disputes`, { reason: 'staff-initiated' });
  assert.equal(r.status, 200);
  assert.equal(r.body.dispute.verdict, 'seller_fault');
});

test('console dispute: the same state checks apply as the agent path (too early, already disputed)', async () => {
  // a fresh seller: sellerA's score has dropped from the fault outcomes the earlier dispute tests recorded
  // against it, low enough to now fail the buyer's own default minCounterpartyScore policy
  const sellerC = await w.agent('FilterSellerC');
  const { tx } = await fundedOrder(buyer, sellerC, { category: 'data', priceCents: 2000 });
  acmeAdmin = await acmeAdminUser.signIn(); // fresh session: prior tests in this file advanced the clock
  const early = await acmeAdmin.req('POST', `/v1/console/transactions/${tx.id}/disputes`, { reason: 'too soon' });
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, 'PREMATURE_DISPUTE');

  w.clock.advance(DAY + HOUR);
  acmeAdmin = await acmeAdminUser.signIn();
  const first = await acmeAdmin.req('POST', `/v1/console/transactions/${tx.id}/disputes`, { reason: 'now' });
  assert.equal(first.status, 200);
  const again = await acmeAdmin.req('POST', `/v1/console/transactions/${tx.id}/disputes`, { reason: 'twice' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'BAD_STATE');
});
