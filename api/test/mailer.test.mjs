import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MailerService } from '../dist/core/mailer.service.js';

const opts = (o = {}) => ({ devMailbox: false, resendApiKey: 're_test', mailFrom: 'Bond <no-reply@example.com>', ...o });
const msg = { to: 'a@b.test', subject: 'Hi', text: 'Hello <b>', link: 'https://x.test/verify#token=abc' };

async function withFetch(fn, body) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return fn(calls.length); };
  try { await body(calls); } finally { globalThis.fetch = real; }
}

test('mode: dev mailbox wins over an API key; a key selects resend; nothing selects console', () => {
  assert.equal(new MailerService(opts({ devMailbox: true })).mode, 'memory');
  assert.equal(new MailerService(opts()).mode, 'resend');
  assert.equal(new MailerService(opts({ resendApiKey: undefined })).mode, 'console');
});

test('resend: posts the message with auth, from address, the link in both bodies, and escaped html', async () => {
  await withFetch(() => new Response('{"id":"1"}', { status: 200 }), async (calls) => {
    await new MailerService(opts()).send(msg);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.resend.com/emails');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test');
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.from, 'Bond <no-reply@example.com>');
    assert.deepEqual(body.to, ['a@b.test']);
    assert.ok(body.text.includes(msg.link));
    assert.ok(body.html.includes('Hello &lt;b&gt;') && body.html.includes(msg.link));
  });
});

test('resend: a 5xx is retried once with the same idempotency key', async () => {
  await withFetch((n) => new Response('{}', { status: n === 1 ? 503 : 200 }), async (calls) => {
    await new MailerService(opts()).send(msg);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].init.headers['Idempotency-Key'], calls[1].init.headers['Idempotency-Key']);
  });
});

test('resend: a 4xx is not retried and does not throw', async () => {
  const err = console.error; console.error = () => {};
  try {
    await withFetch(() => new Response('{}', { status: 403 }), async (calls) => {
      await new MailerService(opts()).send(msg);
      assert.equal(calls.length, 1);
    });
  } finally { console.error = err; }
});

test('resend: a network failure does not throw and never logs the message body or link', async () => {
  const logged = []; const err = console.error; console.error = (...a) => logged.push(a.join(' '));
  try {
    await withFetch(() => { throw new Error('boom'); }, async () => { await new MailerService(opts()).send(msg); });
  } finally { console.error = err; }
  assert.ok(logged.length > 0);
  assert.ok(!logged.join('\n').includes('token=abc'));
});
