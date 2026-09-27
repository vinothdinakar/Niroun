import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { testApp } from '../test-support/helpers.mjs';

// The API is now JSON-only and is reached through the dashboard's proxy. These cover what that changed.

async function withApp(options, fn) {
  const app = await testApp(options);
  const port = await app.listen(0);
  try {
    await fn(`http://127.0.0.1:${port}`, app);
  } finally {
    await app.close();
  }
}
const call = async (base, method, path, body, headers = {}) => {
  const res = await fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), headers: res.headers };
};

test('the API serves JSON only: no UI files, and everything it sends forbids being embedded or sniffed', async () => {
  await withApp({}, async (base) => {
    const root = await call(base, 'GET', '/');
    assert.equal(root.status, 200);
    assert.equal(root.body.name, 'Bond API');
    for (const path of ['/app.js', '/index.html', '/styles.css', '/public/app.js', '/../package.json']) {
      assert.equal((await call(base, 'GET', path)).status, 404, path);
    }
    const h = (await call(base, 'GET', '/v1/health')).headers;
    assert.equal(h.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");
    assert.equal(h.get('x-content-type-options'), 'nosniff');
    assert.equal(h.get('x-frame-options'), 'DENY');
    assert.equal(h.get('cache-control'), 'no-store');
  });
});

test('trusted origins: the dashboard\'s origin may write through the proxy; everyone else is refused', async () => {
  const login = (base, origin) => call(base, 'POST', '/v1/auth/login', { email: 'x@test.example', password: 'not-a-real-password' }, { Origin: origin });

  await withApp({ allowedOrigins: ['http://localhost:3000/'] }, async (base) => {
    assert.equal((await login(base, 'http://localhost:3000')).status, 401, 'allowed: reaches the login check (and fails it, as expected)');
    for (const evil of ['https://evil.example', 'http://localhost:3001', 'http://localhost:3000.evil.example', 'null']) {
      const r = await login(base, evil);
      assert.equal(r.status, 403, evil);
      assert.equal(r.body.error.code, 'BAD_ORIGIN');
    }
    assert.equal((await call(base, 'POST', '/v1/auth/login', { email: 'x@test.example', password: 'x' })).status, 401, 'no Origin header (a script or the SDK) is fine');
  });

  await withApp({}, async (base) => {
    assert.equal((await login(base, 'http://localhost:3000')).status, 403, 'with nothing configured, only same-origin is trusted');
  });
});

test('rate limits follow the real visitor behind a proxy, and only when proxy headers are trusted', async () => {
  const form = () => {
    const n = randomBytes(4).toString('hex');
    return { name: 'Pat', email: `pat-${n}@limits.test`, company: `Limits ${n} Ltd`, password: 'Lm-' + randomBytes(12).toString('base64url'), acceptTerms: true };
  };
  const signup = (base, ip) => call(base, 'POST', '/v1/signup', form(), ip ? { 'X-Forwarded-For': ip } : {});

  await withApp({ signup: 'open', devMailbox: true, trustProxy: true }, async (base) => {
    for (let i = 0; i < 5; i++) assert.equal((await signup(base, '203.0.113.7')).status, 202);
    assert.equal((await signup(base, '203.0.113.7')).status, 429, 'the same visitor is limited');
    assert.equal((await signup(base, '203.0.113.8')).status, 202, 'a different visitor is not caught by their neighbour\'s limit');
    assert.equal((await signup(base, '203.0.113.9, 10.0.0.1')).status, 202, 'the first address in the chain is the client');
  });

  await withApp({ signup: 'open', devMailbox: true }, async (base) => {
    for (let i = 0; i < 5; i++) assert.equal((await signup(base, `198.51.100.${i}`)).status, 202);
    assert.equal((await signup(base, '198.51.100.200')).status, 429, 'untrusted X-Forwarded-For is ignored: faking addresses does not dodge the limit');
  });
});

test('emailed links point at the dashboard, not at the API', async () => {
  await withApp({ signup: 'open', devMailbox: true, publicUrl: 'https://console.example.com' }, async (base, app) => {
    const n = randomBytes(4).toString('hex');
    await call(base, 'POST', '/v1/signup', { name: 'Pat', email: `pat-${n}@links.test`, company: `Links ${n} Ltd`, password: 'Lk-' + randomBytes(12).toString('base64url'), acceptTerms: true });
    const mail = app.mailer.outbox.at(-1);
    assert.match(mail.link, /^https:\/\/console\.example\.com\/verify#token=[\w-]{20,}$/);
  });
});
