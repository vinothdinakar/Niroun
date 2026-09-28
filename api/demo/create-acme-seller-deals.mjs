// Registers a new agent linked to Acme Corp (via a real enrollment code, the same way the console's
// "Connect agents" page does it) that sells physical_goods, registers a throwaway buyer to trade with it,
// and walks a few deals through the full lifecycle (propose -> accept -> pay -> deliver -> receipt).
// Agent keys are appended to demo/test-agent-keys.json, same as register-test-agent.mjs.
//
//   node demo/create-acme-seller-deals.mjs [--baseUrl=http://localhost:4100] [--deals=3]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BondClient } from '../sdk/index.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v = 'true'] = a.replace(/^--/, '').split('=');
  return [k, v];
}));
const baseUrl = args.baseUrl || 'http://localhost:4100';
const DEAL_COUNT = Number(args.deals) || 3;

// ---- a minimal cookie-holding console client, just enough to create an enrollment code ----
async function signIn(email, password) {
  let cookie = '';
  const req = async (method, path, body) => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
    return json;
  };
  await req('POST', '/v1/auth/login', { email, password });
  return req;
}

function saveKeys(entries) {
  const keysFile = fileURLToPath(new URL('./test-agent-keys.json', import.meta.url));
  const store = existsSync(keysFile)
    ? JSON.parse(readFileSync(keysFile, 'utf8'))
    : { note: 'Agents registered via register-test-agent.mjs / create-acme-seller-deals.mjs. The server never sees these private keys — this file is the only copy, so treat it like a credential.', agents: [] };
  store.agents.push(...entries);
  writeFileSync(keysFile, JSON.stringify(store, null, 2));
}

// ---- 1. an Acme owner generates an enrollment code, exactly as the "Connect agents" page does ----
const req = await signIn('owner@acme.test', 'd1BpIcc_isl0BNGAZ2yU');
const enrollment = await req('POST', '/v1/console/enrollments', { label: 'AcmePhysicalSeller' });
console.log(`Enrollment code generated for ${enrollment.orgName} (${enrollment.orgId})`);

// ---- 2. register the seller against that code: it's now linked to Acme Corp, like any agent an owner connects ----
const seller = await BondClient.register({
  baseUrl, name: 'AcmePhysicalSeller', owner: 'Acme Corp', enrollmentCode: enrollment.code,
  policy: { perTxLimitCents: 1_000_000, dailyLimitCents: 10_000_000 }, // sellers rarely buy, but every agent has a mandate
});
console.log(`Registered seller ${seller.agentId} (AcmePhysicalSeller, linked to Acme Corp)`);

// ---- 3. a throwaway buyer to trade with it; minCounterpartyScore 0 so a brand-new, unscored seller isn't blocked ----
const buyer = await BondClient.register({
  baseUrl, name: 'PhysicalGoodsBuyer', owner: 'Test Buyer Co.',
  policy: { perTxLimitCents: 200_000, dailyLimitCents: 1_000_000, minCounterpartyScore: 0, allowedCategories: ['physical_goods'] },
});
console.log(`Registered buyer ${buyer.agentId} (PhysicalGoodsBuyer, unaffiliated)`);

saveKeys([
  { name: 'AcmePhysicalSeller', owner: 'Acme Corp', role: 'seller', agentId: seller.agentId, keys: seller.keys, registeredAt: new Date().toISOString() },
  { name: 'PhysicalGoodsBuyer', owner: 'Test Buyer Co.', role: 'buyer', agentId: buyer.agentId, keys: buyer.keys, registeredAt: new Date().toISOString() },
]);

// ---- 4. walk a few deals through the full lifecycle ----
const items = [
  { spec: 'physical_goods order #1: 200 units of packaging foam', priceCents: 48000 },
  { spec: 'physical_goods order #2: warehouse pallets (x40)', priceCents: 76500 },
  { spec: 'physical_goods order #3: steel shelving units (x12)', priceCents: 32400 },
];

const results = [];
for (let i = 0; i < DEAL_COUNT; i++) {
  const item = items[i % items.length];
  const { transaction } = await buyer.purchase({
    counterparty: seller.agentId, spec: item.spec, priceCents: item.priceCents, category: 'physical_goods',
    deliverBy: Date.now() + 24 * 3600 * 1000,
  });
  await seller.accept(transaction.id, transaction.termsHash);
  await buyer.pay(transaction);
  await seller.deliver(transaction.id, item.spec, 'shipped via freight');
  const fulfilled = await buyer.receipt(transaction.id, { item: item.spec, ok: true });
  results.push({ id: transaction.id, spec: item.spec, priceCents: item.priceCents, status: fulfilled.status });
  console.log(`Deal ${transaction.id}: ${item.spec} — $${(item.priceCents / 100).toFixed(2)} — ${fulfilled.status}`);
}

console.log(`\nDone. ${results.length} deal(s) created and fulfilled between AcmePhysicalSeller and PhysicalGoodsBuyer.`);
