import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../test-support/helpers.mjs';

let w, n = 0;
before(async () => { w = await setup(); });
after(async () => { await w.close(); });

const businessFields = { legalName: 'Acme Testing LLC', registrationNumber: 'EIN-123456', address: '1 Main St', website: 'https://acme.test' };
const individualFields = { legalName: 'Jordan Lee', idType: 'passport', idNumber: 'P123456', address: '2 Elm St' };

async function ownerFor(accountType) {
  const org = await w.app.accounts.createOrg(`Verif Test ${++n}`, null, accountType);
  const owner = await w.makeUser({ role: 'owner_admin', orgId: org.id });
  return { org, owner };
}

test('an org admin applies for level 1, staff approve it, and it cascades to the org\'s agents', async () => {
  const { org, owner } = await ownerFor('business');
  const session = await owner.signIn();
  const r = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields: businessFields });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'pending');
  assert.equal(r.body.orgId, org.id);
  assert.equal(r.body.accountType, 'business');
  assert.deepEqual(r.body.fields, businessFields);

  // enroll an agent before approval: it should still pick up the level once approved
  const enr = await session.req('POST', '/v1/console/enrollments', {});
  const agent = await w.agent('VerifCascade', undefined, { enrollmentCode: enr.body.code });
  assert.equal((await agent.score()).verification, 0);

  const decided = await w.admin('POST', `/v1/console/verification-requests/${r.body.id}/decide`, { decision: 'approve' });
  assert.equal(decided.request.status, 'approved');
  assert.equal(decided.org.verification, 1);
  assert.equal((await agent.score()).verification, 1, 'existing agent picked up the new level');
});

test('rejecting records a reason and never touches the org\'s verification', async () => {
  const { owner } = await ownerFor('individual');
  const session = await owner.signIn();
  const r = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields: individualFields });
  const decided = await w.admin('POST', `/v1/console/verification-requests/${r.body.id}/decide`, { decision: 'reject', reason: 'ID number does not match name' });
  assert.equal(decided.request.status, 'rejected');
  assert.equal(decided.request.rejectionReason, 'ID number does not match name');
  assert.equal(decided.org, undefined);

  const orgs = await session.req('GET', '/v1/console/orgs');
  assert.equal(orgs.body.orgs[0].verification, 0);
});

test('validation: missing fields, wrong level, one pending at a time, and only an owner_admin may apply', async () => {
  const { owner, org } = await ownerFor('business');
  const session = await owner.signIn();

  const missing = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields: { legalName: 'X' } });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'MISSING_FIELD');

  const badLevel = await session.req('POST', '/v1/console/verification-requests', { level: 3, fields: businessFields });
  assert.equal(badLevel.status, 400);
  assert.equal(badLevel.body.error.code, 'INVALID_LEVEL');

  const ok = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields: businessFields });
  assert.equal(ok.status, 201);
  const again = await session.req('POST', '/v1/console/verification-requests', { level: 2, fields: businessFields });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'REQUEST_PENDING');

  const viewer = await w.makeUser({ role: 'owner_viewer', orgId: org.id });
  const viewerSession = await viewer.signIn();
  const forbidden = await viewerSession.req('POST', '/v1/console/verification-requests', { level: 1, fields: businessFields });
  assert.equal(forbidden.status, 403);
});

test('requesting a level the org already has (or exceeds) is refused', async () => {
  const { owner, org } = await ownerFor('business');
  await w.admin('POST', `/v1/console/orgs/${org.id}/verify`, { level: 2 });
  const session = await owner.signIn();
  const r = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields: businessFields });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'ALREADY_AT_LEVEL');
});

test('an individual applies with ID fields, not business fields', async () => {
  const { owner } = await ownerFor('individual');
  const session = await owner.signIn();
  const wrongShape = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields: businessFields });
  assert.equal(wrongShape.status, 400, 'business fields have no idType/idNumber, which an individual actually needs');

  const ok = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields: individualFields });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.accountType, 'individual');
});

test('list: staff see every request, an org sees only its own', async () => {
  const { owner: ownerA } = await ownerFor('business');
  const { owner: ownerB } = await ownerFor('business');
  const sessionA = await ownerA.signIn();
  const sessionB = await ownerB.signIn();
  const ra = await sessionA.req('POST', '/v1/console/verification-requests', { level: 1, fields: businessFields });
  const rb = await sessionB.req('POST', '/v1/console/verification-requests', { level: 1, fields: businessFields });

  const forA = await sessionA.req('GET', '/v1/console/verification-requests');
  assert.equal(forA.body.requests.length, 1);
  assert.equal(forA.body.requests[0].id, ra.body.id);

  const forStaff = await w.admin('GET', '/v1/console/verification-requests');
  const ids = forStaff.requests.map((x) => x.id);
  assert.ok(ids.includes(ra.body.id) && ids.includes(rb.body.id));
});

test('a decided request cannot be decided twice, and only staff may decide', async () => {
  const { owner } = await ownerFor('business');
  const session = await owner.signIn();
  const r = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields: businessFields });

  const byOwner = await session.req('POST', `/v1/console/verification-requests/${r.body.id}/decide`, { decision: 'approve' });
  assert.equal(byOwner.status, 403);

  const adminSession = await w.adminUser.signIn();
  const first = await adminSession.req('POST', `/v1/console/verification-requests/${r.body.id}/decide`, { decision: 'approve' });
  assert.equal(first.status, 200);
  const second = await (await w.adminUser.signIn()).req('POST', `/v1/console/verification-requests/${r.body.id}/decide`, { decision: 'approve' });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'ALREADY_DECIDED');
});

test('agents carry their owning org\'s account type, in the list and on the profile', async () => {
  const { owner } = await ownerFor('individual');
  const session = await owner.signIn();
  const enr = await session.req('POST', '/v1/console/enrollments', {});
  const agent = await w.agent('PersonalBot', undefined, { enrollmentCode: enr.body.code });
  const id = (await agent.score()).id;

  const profile = await session.req('GET', `/v1/agents/${id}`);
  assert.equal(profile.body.accountType, 'individual');
  const list = await session.req('GET', '/v1/agents');
  assert.equal(list.body.agents.find((a) => a.id === id).accountType, 'individual');

  const unlinked = await w.agent('FreeBot');
  const uid = (await unlinked.score()).id;
  assert.equal((await session.req('GET', '/v1/agents')).body.agents.find((a) => a.id === uid).accountType, 'business');
});
