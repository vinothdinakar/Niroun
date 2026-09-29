import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../test-support/helpers.mjs';

let w, n = 0;
before(async () => { w = await setup(); });
after(async () => { await w.close(); });

async function ownerFor(role = 'owner_admin') {
  const org = await w.app.accounts.createOrg(`Profile Test ${++n}`, null, 'business');
  const user = await w.makeUser({ role, orgId: org.id });
  return { org, session: await user.signIn() };
}

const profile = { about: 'We build supply-chain agents.', website: 'https://acme.test', contactEmail: 'hello@acme.test', country: 'Canada', industry: 'Logistics' };

test('an org admin edits their profile, and it shows on the org', async () => {
  const { org, session } = await ownerFor();
  const put = await session.req('PUT', `/v1/console/orgs/${org.id}/profile`, profile);
  assert.equal(put.status, 200);
  assert.deepEqual({ about: put.body.about, website: put.body.website, contactEmail: put.body.contactEmail, country: put.body.country, industry: put.body.industry }, profile);
  const orgs = await session.req('GET', '/v1/console/orgs');
  assert.equal(orgs.body.orgs[0].about, profile.about);
  assert.equal(orgs.body.orgs[0].name, org.name, 'the name is not part of the profile');
});

test('only fields that are sent change, and an empty value clears one', async () => {
  const { org, session } = await ownerFor();
  await session.req('PUT', `/v1/console/orgs/${org.id}/profile`, profile);
  const partial = await session.req('PUT', `/v1/console/orgs/${org.id}/profile`, { country: '  Norway ', industry: '' });
  assert.equal(partial.body.country, 'Norway', 'trimmed');
  assert.equal(partial.body.industry, undefined, 'cleared');
  assert.equal(partial.body.about, profile.about, 'untouched');
  assert.equal(partial.body.website, profile.website);
});

test('values are validated', async () => {
  const { org, session } = await ownerFor();
  const put = (body) => session.req('PUT', `/v1/console/orgs/${org.id}/profile`, body);
  assert.equal((await put({ website: 'javascript:alert(1)' })).body.error.code, 'INVALID_PROFILE');
  assert.equal((await put({ website: 'acme.test' })).status, 400, 'needs the scheme');
  assert.equal((await put({ contactEmail: 'not an email' })).status, 400);
  assert.equal((await put({ about: 'x'.repeat(501) })).status, 400);
  assert.equal((await put({ country: 42 })).status, 400);
  assert.equal((await put({ website: 'http://ok.test' })).status, 200);
});

test('a viewer cannot edit; one org cannot edit another; signed-out cannot', async () => {
  const { org } = await ownerFor();
  const viewer = await w.makeUser({ role: 'owner_viewer', orgId: org.id });
  assert.equal((await (await viewer.signIn()).req('PUT', `/v1/console/orgs/${org.id}/profile`, profile)).status, 403);

  const { session: other } = await ownerFor();
  const cross = await other.req('PUT', `/v1/console/orgs/${org.id}/profile`, profile);
  assert.equal(cross.status, 404, 'another org\'s admin does not learn the org exists');

  const anon = await fetch(`${w.baseUrl}/v1/console/orgs/${org.id}/profile`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(anon.status, 401);
});

test('staff can edit any org\'s profile, and the change is audited', async () => {
  const { org } = await ownerFor();
  const staff = await w.adminUser.signIn();
  const put = await staff.req('PUT', `/v1/console/orgs/${org.id}/profile`, { about: 'Edited by staff' });
  assert.equal(put.status, 200);
  const audit = await w.admin('GET', '/v1/console/audit');
  assert.ok(JSON.stringify(audit).includes('org.profile_update'));
});
