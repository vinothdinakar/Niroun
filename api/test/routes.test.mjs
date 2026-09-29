import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import { ModulesContainer } from '@nestjs/core';
import { testApp } from '../test-support/helpers.mjs';

// Architecture tests: they inspect every route the framework registered, so a new endpoint that
// forgets its access rules is caught here instead of in production.

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];
let app;
let routes;

before(async () => {
  app = await testApp();
  routes = [];
  for (const mod of app.nest.get(ModulesContainer).values()) {
    for (const ctrl of mod.controllers.values()) {
      const proto = Object.getPrototypeOf(ctrl.instance);
      const base = Reflect.getMetadata('path', ctrl.metatype) ?? '';
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const path = Reflect.getMetadata('path', handler);
        if (path === undefined) continue; // a helper method, not a route
        const full = ('/' + [base, path].filter((s) => s && s !== '/').join('/')).replace(/\/+/g, '/');
        routes.push({
          route: `${METHODS[Reflect.getMetadata('method', handler)]} ${full}`,
          // the same lookup AuthGuard does: the method, then the controller, then the default
          access: Reflect.getMetadata('bond:access', handler) ?? Reflect.getMetadata('bond:access', ctrl.metatype) ?? 'user',
          permission: Reflect.getMetadata('bond:permission', handler) ?? null,
        });
      }
    }
  }
});
after(async () => { await app.close(); });

test('the API exposes the routes we expect', () => {
  assert.equal(routes.length, 70, `found ${routes.length} routes; if you added or removed an endpoint on purpose, update this number`);
  const names = new Set(routes.map((r) => r.route));
  for (const must of ['POST /v1/quotes', 'POST /v1/transactions/:id/events', 'GET /v1/agents/:id/ledger', 'PUT /v1/console/agents/:id/policy', 'POST /v1/console/sweep']) {
    assert.ok(names.has(must), `missing ${must}`);
  }
});

test('only the deliberate list of routes is public; everything else needs someone signed in or a signed agent', () => {
  const publicRoutes = routes.filter((r) => r.access === 'public').map((r) => r.route).sort();
  assert.deepEqual(publicRoutes, [
    'GET /',
    'GET /v1/dev/outbox',
    'GET /v1/dev/sms-outbox',
    'GET /v1/health',
    'POST /v1/auth/2fa/begin',
    'POST /v1/auth/2fa/confirm',
    'POST /v1/auth/2fa/verify',
    'POST /v1/auth/accept-invite',
    'POST /v1/auth/email/verify/confirm',
    'POST /v1/auth/login',
    'POST /v1/auth/logout',
    'POST /v1/signup',
    'POST /v1/signup/resend',
    'POST /v1/signup/verify',
  ].sort());
});

test('every console route requires a signed-in person (by default, not by remembering to say so)', () => {
  const consoleRoutes = routes.filter((r) => r.route.includes('/v1/console/'));
  assert.ok(consoleRoutes.length >= 17);
  for (const r of consoleRoutes) assert.equal(r.access, 'user', r.route);
});

test('staff-only actions are guarded by a named permission', () => {
  const guarded = new Map(routes.filter((r) => r.permission).map((r) => [r.route, r.permission]));
  assert.equal(guarded.get('GET /v1/stats'), 'stats');
  assert.equal(guarded.get('POST /v1/console/sweep'), 'sweep');
  assert.equal(guarded.get('POST /v1/console/agents/:id/verify'), 'verify');
  assert.equal(guarded.get('POST /v1/console/disputes/:id/resolve'), 'resolve');
  assert.equal(guarded.get('GET /v1/console/audit'), 'audit');
  assert.equal(guarded.get('POST /v1/console/orgs'), 'orgs');
  assert.equal(guarded.get('POST /v1/console/orgs/:id/account-type'), 'orgs');
  assert.equal(guarded.get('PUT /v1/console/orgs/:id/profile'), 'org_manage');
  assert.equal(guarded.get('POST /v1/console/verification-requests'), 'request_verification');
  assert.equal(guarded.get('POST /v1/console/verification-documents'), 'request_verification');
  assert.equal(guarded.get('POST /v1/console/verification-requests/:id/decide'), 'verify');
  assert.equal(guarded.get('POST /v1/console/verification-requests/:id/withdraw'), 'request_verification');
  assert.equal(guarded.get('PUT /v1/console/agents/:id/policy'), 'agents_manage');
  assert.equal(guarded.get('POST /v1/console/agents/:id/status'), 'agents_suspend');
  assert.equal(guarded.get('POST /v1/console/transactions/:id/disputes'), 'agents_manage');
});

test('anonymous requests to every non-public GET route are refused', async () => {
  const port = await app.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const gets = routes.filter((r) => r.route.startsWith('GET ') && r.access !== 'public');
  assert.ok(gets.length >= 10);
  for (const r of gets) {
    const path = r.route.slice(4).replace(/:(\w+)/g, 'x');
    const res = await fetch(base + path);
    assert.equal(res.status, 401, `${r.route} answered ${res.status} to an anonymous caller`);
  }
});
