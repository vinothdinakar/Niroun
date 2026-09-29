import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../test-support/helpers.mjs';

let w;
before(async () => { w = await setup(); });
after(async () => { await w.close(); });

test('a person can change their own display name, and only that', async () => {
  const org = await w.app.accounts.createOrg('Account Settings Co', null, 'business');
  const user = await w.makeUser({ role: 'owner_viewer', orgId: org.id });
  const session = await user.signIn();

  const put = await session.req('PUT', '/v1/auth/me', { name: '  Grace Hopper ', role: 'admin', email: 'x@y.test' });
  assert.equal(put.status, 200);
  assert.equal(put.body.user.name, 'Grace Hopper', 'trimmed');
  assert.equal(put.body.user.role, 'owner_viewer', 'role is not editable here');
  assert.equal(put.body.user.email, user.email, 'email is not editable here');
  assert.equal((await session.req('GET', '/v1/auth/me')).body.user.name, 'Grace Hopper', 'persisted');

  assert.equal((await session.req('PUT', '/v1/auth/me', { name: '   ' })).status, 400);
  assert.equal((await session.req('PUT', '/v1/auth/me', { name: 'x'.repeat(81) })).status, 400);
  assert.equal((await session.req('PUT', '/v1/auth/me', { name: 42 })).status, 400);

  const audit = await w.admin('GET', '/v1/console/audit');
  assert.ok(JSON.stringify(audit).includes('user.rename'));
});

test('signed-out callers cannot rename anyone', async () => {
  const res = await fetch(`${w.baseUrl}/v1/auth/me`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Eve"}' });
  assert.equal(res.status, 401);
});
