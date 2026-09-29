import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setup, DAY } from '../test-support/helpers.mjs';
import { GcsFileStore } from '../dist/storage/file-store.js';

let w, n = 0;
before(async () => { w = await setup(); });
after(async () => { await w.close(); });

const PDF = Buffer.from('%PDF-1.4\n%certificate of incorporation\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake image body')]);
const fields = { legalName: 'Acme Testing LLC', registrationNumber: 'EIN-123456', address: '1 Main St' };
const store = () => w.app.options.fileStore;

async function ownerFor(accountType = 'business') {
  const org = await w.app.accounts.createOrg(`Docs Test ${++n}`, null, accountType);
  const owner = await w.makeUser({ role: 'owner_admin', orgId: org.id });
  return { org, owner, session: await owner.signIn() };
}

async function apply(session, extra = {}) {
  const up = await session.upload('incorporation', PDF, 'application/pdf', 'cert.pdf');
  const r = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields, documentIds: [up.body.id], ...extra });
  return { up, r };
}

test('an upload is stored in the file store and described without its storage location', async () => {
  const { org, session } = await ownerFor();
  const up = await session.upload('incorporation', PDF, 'application/pdf', 'cert.pdf');
  assert.equal(up.status, 201);
  assert.equal(up.body.kind, 'incorporation');
  assert.equal(up.body.filename, 'cert.pdf');
  assert.equal(up.body.size, PDF.length);
  assert.equal(up.body.contentType, 'application/pdf');
  assert.match(up.body.sha256, /^[0-9a-f]{64}$/);
  assert.equal(up.body.storageKey, undefined, 'callers never learn where the bytes live');
  assert.deepEqual(await store().get(`verification/${org.id}/${up.body.id}`), PDF);
});

test('what is accepted: PDF/PNG/JPEG whose bytes match, at most 5 MB, of a kind that suits the account type', async () => {
  const { session } = await ownerFor('business');
  const html = await session.upload('incorporation', Buffer.from('<script>alert(1)</script>'), 'text/html');
  assert.equal(html.status, 415);
  assert.equal(html.body.error.code, 'UNSUPPORTED_FILE_TYPE');

  const lying = await session.upload('incorporation', Buffer.from('<html>not a png</html>'), 'image/png');
  assert.equal(lying.status, 415);
  assert.equal(lying.body.error.code, 'FILE_TYPE_MISMATCH');

  const empty = await session.upload('incorporation', Buffer.alloc(0), 'application/pdf');
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error.code, 'EMPTY_FILE');

  const big = await session.upload('incorporation', Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), 'application/pdf');
  assert.equal(big.status, 413);
  assert.equal(big.body.error.code, 'FILE_TOO_LARGE');

  const wrongKind = await session.upload('id_document', PDF, 'application/pdf');
  assert.equal(wrongKind.status, 400, 'a business does not upload a personal ID');
  assert.equal(wrongKind.body.error.code, 'INVALID_DOCUMENT_KIND');

  assert.equal((await session.upload('address_proof', PNG, 'image/png')).status, 201);
});

test('only an org\'s own admin can upload, and a signed-out caller cannot', async () => {
  const { org } = await ownerFor();
  const viewer = await w.makeUser({ role: 'owner_viewer', orgId: org.id });
  assert.equal((await (await viewer.signIn()).upload('incorporation', PDF, 'application/pdf')).status, 403);
  const anon = await fetch(`${w.baseUrl}/v1/console/verification-documents?kind=incorporation`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: PDF });
  assert.equal(anon.status, 401);
});

test('filenames are reduced to a safe base name', async () => {
  const { session } = await ownerFor();
  const up = await session.upload('incorporation', PDF, 'application/pdf', '..\\..\\etc/pass"wd\r\n.pdf');
  assert.equal(up.body.filename, 'passwd.pdf');
});

test('an application needs its required evidence, and only files of its own org that are still unused', async () => {
  const { session } = await ownerFor();
  const none = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields });
  assert.equal(none.status, 400);
  assert.equal(none.body.error.code, 'MISSING_DOCUMENT');

  const optionalOnly = await session.upload('address_proof', PNG, 'image/png');
  const noRequired = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields, documentIds: [optionalOnly.body.id] });
  assert.equal(noRequired.body.error.code, 'MISSING_DOCUMENT', 'address proof alone is not the required certificate');

  const { session: other } = await ownerFor();
  const theirs = await other.upload('incorporation', PDF, 'application/pdf');
  const stolen = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields, documentIds: [theirs.body.id] });
  assert.equal(stolen.body.error.code, 'UNKNOWN_DOCUMENT');
  const ghost = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields, documentIds: ['doc_nope'] });
  assert.equal(ghost.body.error.code, 'UNKNOWN_DOCUMENT');

  const a = await session.upload('incorporation', PDF, 'application/pdf');
  const b = await session.upload('incorporation', PDF, 'application/pdf');
  const twoOfAKind = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields, documentIds: [a.body.id, b.body.id] });
  assert.equal(twoOfAKind.body.error.code, 'DUPLICATE_DOCUMENT_KIND');

  const ok = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields, documentIds: [a.body.id, optionalOnly.body.id] });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.body.documents.map((d) => d.kind), ['incorporation', 'address_proof']);
});

test('an attached file cannot be reused by a later application', async () => {
  const { session } = await ownerFor();
  const { up, r } = await apply(session);
  const adminSession = await w.adminUser.signIn();
  await adminSession.req('POST', `/v1/console/verification-requests/${r.body.id}/decide`, { decision: 'reject', reason: 'blurry' });
  const again = await session.req('POST', '/v1/console/verification-requests', { level: 1, fields, documentIds: [up.body.id] });
  assert.equal(again.body.error.code, 'DOCUMENT_UNAVAILABLE');
});

test('staff can download the evidence (and it is audited); the uploading org can too; nobody else can', async () => {
  const { session } = await ownerFor();
  const { up } = await apply(session);
  const path = `/v1/console/verification-documents/${up.body.id}`;

  const listed = await session.req('GET', '/v1/console/verification-requests');
  assert.equal(listed.body.requests[0].documents[0].id, up.body.id);

  const own = await session.download(path);
  assert.equal(own.status, 200);
  assert.deepEqual(own.data, PDF);
  assert.equal(own.headers.get('content-type'), 'application/pdf');
  assert.match(own.headers.get('content-disposition'), /^attachment;/);

  const staff = await (await w.adminUser.signIn()).download(path);
  assert.deepEqual(staff.data, PDF);
  const audit = await w.admin('GET', '/v1/console/audit');
  assert.ok(JSON.stringify(audit).includes('verification.document_view'), 'a staff view leaves a trail');

  const { session: stranger } = await ownerFor();
  assert.equal((await stranger.download(path)).status, 404);
  const anon = await fetch(w.baseUrl + path);
  assert.equal(anon.status, 401);
});

test('retention: unused uploads clear after a day, applications\' files a set time after the decision', async () => {
  w.clock.advance(100 * DAY);
  await w.app.engine.purgeDocuments(); // clear what earlier tests left behind so the counts below are ours alone
  const { org, session } = await ownerFor();
  const orphan = await session.upload('address_proof', PNG, 'image/png');
  const { up, r } = await apply(session);

  w.clock.advance(23 * 3_600_000);
  assert.equal(await w.app.engine.purgeDocuments(), 0, 'nothing is old enough yet');

  w.clock.advance(2 * 3_600_000);
  assert.equal(await w.app.engine.purgeDocuments(), 1, 'only the upload that never made it into an application');
  assert.equal(store().files.has(`verification/${org.id}/${orphan.body.id}`), false);
  assert.equal(store().files.has(`verification/${org.id}/${up.body.id}`), true);

  // a pending application's evidence is kept however long it waits
  w.clock.advance(200 * DAY);
  assert.equal(await w.app.engine.purgeDocuments(), 0);

  const staff = await w.adminUser.signIn();
  await staff.req('POST', `/v1/console/verification-requests/${r.body.id}/decide`, { decision: 'approve' });
  w.clock.advance(89 * DAY);
  assert.equal(await w.app.engine.purgeDocuments(), 0, 'still inside the 90-day window');
  w.clock.advance(2 * DAY);
  assert.equal(await w.app.engine.purgeDocuments(), 1);
  assert.equal(store().files.has(`verification/${org.id}/${up.body.id}`), false);
  assert.equal(await w.app.engine.purgeDocuments(), 0, 'and it only happens once');

  const gone = await (await w.adminUser.signIn()).download(`/v1/console/verification-documents/${up.body.id}`);
  assert.equal(gone.status, 410);
  const all = await w.admin('GET', '/v1/console/verification-requests');
  const mine = all.requests.find((x) => x.id === r.body.id);
  assert.ok(mine.documents[0].purgedAt, 'the record stays, marked as deleted');
});

test('at most ten unused uploads can be parked at once', async () => {
  const { session } = await ownerFor();
  for (let i = 0; i < 10; i++) assert.equal((await session.upload('address_proof', PNG, 'image/png')).status, 201);
  const over = await session.upload('address_proof', PNG, 'image/png');
  assert.equal(over.status, 429);
  assert.equal(over.body.error.code, 'TOO_MANY_UPLOADS');
});

test('the Google Cloud Storage adapter maps put/get/delete onto a bucket', async () => {
  const objects = new Map();
  const calls = [];
  const bucket = {
    file: (name) => ({
      save: async (data, opts) => { calls.push(['save', name, opts]); objects.set(name, data); },
      download: async () => { if (!objects.has(name)) throw new Error('404'); return [objects.get(name)]; },
      delete: async (opts) => { calls.push(['delete', name, opts]); objects.delete(name); },
    }),
  };
  const gcs = new GcsFileStore(bucket);
  await gcs.put('a/b', Buffer.from('hi'), 'application/pdf');
  assert.deepEqual(calls[0], ['save', 'a/b', { contentType: 'application/pdf', resumable: false }]);
  assert.equal((await gcs.get('a/b')).toString(), 'hi');
  await gcs.delete('a/b');
  assert.deepEqual(calls[1], ['delete', 'a/b', { ignoreNotFound: true }]);
});
