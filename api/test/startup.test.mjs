import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configProblems, describeEnvironment, hostOf, redactUrl, startupHints, took } from '../dist/startup.js';

const SECRETS = {
  BOND_MONGO_URL: 'mongodb+srv://niroun-api:SuperSecretPw9@cluster0.abcde.mongodb.net/?appName=x',
  BOND_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  RESEND_API_KEY: 're_SECRETRESENDKEY123',
  STRIPE_SECRET_KEY: 'sk_test_SECRETSTRIPEKEY123',
  STRIPE_WEBHOOK_SECRET: 'whsec_SECRETWEBHOOK123',
  STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_SECRETCONNECT123',
};
const prod = { NODE_ENV: 'production', BOND_COOKIE_SECURE: '1', BOND_TRUST_PROXY: '1', BOND_PUBLIC_URL: 'https://app.example.com', BOND_STAFF_URL: 'https://admin.example.com', BOND_GCS_BUCKET: 'my-bucket', BOND_MONGO_DB: 'Niroun', ...SECRETS };

test('the startup report never contains a secret, only whether one is present', () => {
  const out = [...describeEnvironment(prod, 8080), ...configProblems(prod)].join('\n');
  for (const [name, value] of Object.entries(SECRETS)) {
    assert.ok(!out.includes(value), `${name}'s value leaked`);
  }
  assert.ok(!out.includes('SuperSecretPw9') && !out.includes('niroun-api:'), 'the database password or user leaked');
  assert.match(out, /BOND_MONGO_URL=yes/);
  assert.match(out, /RESEND_API_KEY=yes/);
  assert.match(out, /host cluster0\.abcde\.mongodb\.net, database Niroun/);
  assert.match(out, /PORT=8080/);
  assert.match(out, /Stripe on, TEST mode/);
  assert.match(out, /Google Cloud Storage bucket my-bucket/);
  assert.match(out, /Resend, from/);
});

test('it says what is missing', () => {
  const out = describeEnvironment({ NODE_ENV: 'production' }, 4100).join('\n');
  assert.match(out, /BOND_MONGO_URL=no/);
  assert.match(out, /BOND_ENCRYPTION_KEY=no \(falls back to key file/);
  assert.match(out, /PORT is not set/);
  assert.match(out, /Stripe off/);
  assert.match(out, /local disk/);
  assert.match(out, /printed to the console/);
});

test('it notices Cloud Run', () => {
  const out = describeEnvironment({ K_SERVICE: 'niroun-api', K_REVISION: 'niroun-api-00005-826', K_CONFIGURATION: 'niroun-api' }, 8080).join('\n');
  assert.match(out, /cloud run: service niroun-api, revision niroun-api-00005-826/);
});

test('a production server with nothing configured gets clear warnings', () => {
  const problems = configProblems({ NODE_ENV: 'production' }).join('\n');
  assert.match(problems, /BOND_MONGO_URL is not set/);
  assert.match(problems, /BOND_ENCRYPTION_KEY is not set/);
  assert.match(problems, /BOND_COOKIE_SECURE/);
  assert.match(problems, /BOND_PUBLIC_URL is not set/);
});

test('a well-configured production server gets no warnings', () => {
  assert.deepEqual(configProblems({ ...prod, STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined, STRIPE_CONNECT_WEBHOOK_SECRET: undefined }), []);
});

test('it catches mistakes in values, not just missing ones', () => {
  const p = (env) => configProblems({ ...prod, ...env }).join('\n');
  assert.match(p({ BOND_PUBLIC_URL: 'app.example.com' }), /BOND_PUBLIC_URL is not a full URL/);
  assert.match(p({ BOND_STAFF_URL: 'nope' }), /BOND_STAFF_URL is not a full URL/);
  assert.match(p({ BOND_ENCRYPTION_KEY: 'too-short' }), /exactly 32 bytes/);
  assert.match(p({ RESEND_API_KEY: 're_abc\n' }), /whitespace/);
  assert.match(p({ BOND_DEV_MAILBOX: '1' }), /overrides RESEND_API_KEY/);
  assert.match(p({ STRIPE_WEBHOOK_SECRET: undefined, STRIPE_CONNECT_WEBHOOK_SECRET: undefined }), /Stripe webhooks will be refused/);
  assert.match(p({}), /Stripe is in TEST mode on a production server/);
  assert.doesNotMatch(p({}), /whsec_|sk_test_/);
});

test('connection strings are reduced to a host, and passwords are hidden', () => {
  assert.equal(redactUrl(SECRETS.BOND_MONGO_URL), 'mongodb+srv://***@cluster0.abcde.mongodb.net/?appName=x');
  assert.equal(redactUrl('mongodb://127.0.0.1:27017/?replicaSet=rs0'), 'mongodb://127.0.0.1:27017/?replicaSet=rs0');
  assert.equal(hostOf(SECRETS.BOND_MONGO_URL), 'cluster0.abcde.mongodb.net');
  assert.equal(hostOf('mongodb://u:p@127.0.0.1:27017/?replicaSet=rs0'), '127.0.0.1:27017');
  assert.equal(hostOf(undefined), 'default (local)');
});

test('a failed start is explained in plain language', () => {
  const hints = (msg, name = 'Error') => startupHints(Object.assign(new Error(msg), { name })).join(' | ');
  assert.match(hints('Server selection timed out after 8000 ms', 'MongoServerSelectionError'), /Network Access[\s\S]*0\.0\.0\.0\/0/);
  assert.match(hints('Cannot reach MongoDB at mongodb://***@h after 8.0 s: boom'), /MongoDB is not reachable/);
  assert.match(hints('getaddrinfo ENOTFOUND cluster0.abcde.mongodb.net'), /not reachable/);
  assert.match(hints('bad auth : Authentication failed.'), /rejected the login[\s\S]*URL-encoded/);
  assert.match(hints('BOND_ENCRYPTION_KEY must be 32 bytes, base64-encoded'), /openssl rand -base64 32/);
  assert.match(hints('Invalid URL', 'TypeError'), /full URL/);
  assert.match(hints('listen EADDRINUSE: address already in use :::8080'), /port is already in use/);
  assert.match(hints("Cannot find module 'stripe'"), /missing from the built image/);
  assert.match(hints('Index already exists with different options', 'IndexOptionsConflict'), /index could not be created/);
  assert.deepEqual(startupHints(new Error('something entirely unexpected')), [], 'no invented advice');
  assert.deepEqual(startupHints('plain string'), []);
});

test('durations read naturally', () => {
  assert.equal(took(340), '340 ms');
  assert.equal(took(1234), '1.2 s');
  assert.equal(took(0), '0 ms');
});
