// Registers one agent against an already-running Bond API (e.g. the one `npm run demo` left up on :4100)
// and — unlike the demo simulation, which discards its agents' keys when the process exits — saves the
// keypair to demo/test-agent-keys.json so it can be reused across runs of this script or in the SDK later.
//
//   node demo/register-test-agent.mjs --name=TestSeller --owner="Test Seller Co." --role=seller
//   node demo/register-test-agent.mjs --name=TestBuyer --owner="Test Buyer Co." --role=buyer --perTxLimitCents=100000 --dailyLimitCents=400000
//
// `--role` is cosmetic (agents aren't buyer- or seller-only — any agent can call quote()/purchase() or
// accept()/deliver()); it only picks a sensible default mandate so a "seller" isn't stopped by its own
// tiny per-transaction limit the first time someone tries to buy from it.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BondClient } from '../sdk/index.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v = 'true'] = a.replace(/^--/, '').split('=');
  return [k, v];
}));

const baseUrl = args.baseUrl || 'http://localhost:4100';
const name = args.name;
if (!name) {
  console.error('Usage: node demo/register-test-agent.mjs --name=<AgentName> [--owner="Owner Co."] [--role=seller|buyer] [--enrollmentCode=...] [--perTxLimitCents=N] [--dailyLimitCents=N]');
  process.exit(1);
}
const owner = args.owner || `${name} Inc.`;
const role = args.role || 'seller';
const policy = {
  perTxLimitCents: Number(args.perTxLimitCents) || (role === 'seller' ? 1_000_000 : 150_000),
  dailyLimitCents: Number(args.dailyLimitCents) || (role === 'seller' ? 10_000_000 : 400_000),
};

const client = await BondClient.register({ baseUrl, name, owner, policy, enrollmentCode: args.enrollmentCode });

const keysFile = fileURLToPath(new URL('./test-agent-keys.json', import.meta.url));
const store = existsSync(keysFile)
  ? JSON.parse(readFileSync(keysFile, 'utf8'))
  : { note: 'Agents registered via register-test-agent.mjs. The server never sees these private keys — this file is the only copy, so treat it like a credential.', agents: [] };
store.agents.push({ name, owner, role, agentId: client.agentId, keys: client.keys, registeredAt: new Date().toISOString() });
writeFileSync(keysFile, JSON.stringify(store, null, 2));

console.log(`Registered ${name} (${owner}) as ${client.agentId}`);
console.log(`Keys appended to demo/test-agent-keys.json — load them with BondClient's constructor (new BondClient({ baseUrl, keys, agentId })) to act as this agent again.`);
