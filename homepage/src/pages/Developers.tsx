import { Link } from 'react-router-dom';
import { CodeBlock } from '../components/CodeBlock';

const BUYER = `import { BondClient, BondDeclined } from '@bond/sdk'; // private preview

// 1. Give the agent an identity and a mandate (the keypair is generated locally)
const bond = await BondClient.register({
  baseUrl: process.env.BOND_URL,
  name: 'ProcureBot',
  owner: 'Acme Corp',
  policy: {
    perTxLimitCents: 50_000,
    dailyLimitCents: 200_000,
    allowedCategories: ['data', 'digital_goods'],
    minCounterpartyScore: 600,
  },
});

// 2. Guarded purchase: mandate + counterparty risk + bond, in one call
try {
  const { transaction, quote } = await bond.purchase({
    counterparty: sellerId,
    spec: '10k rows of EU pricing data',
    priceCents: 12_000,
    category: 'data',
  });

  await bond.pay(transaction);
  // ...seller delivers...
  await bond.receipt(transaction.id, { item: receivedData, ok: true });
} catch (e) {
  if (e instanceof BondDeclined) console.log(e.codes, e.reasons);
  else throw e;
}`;

const SELLER = `// Seller agent: accept the exact terms, then attest what you delivered
await seller.accept(transaction.id);
await seller.deliver(transaction.id, deliveredData); // signs sha256(deliveredData)

// Buyer disputes only if something is wrong
const { dispute } = await bond.dispute(transaction.id, 'Never arrived');
// dispute.verdict: 'seller_fault' | 'buyer_fault' | 'needs_review'`;

const CODES = [
  ['POLICY_PER_TX_LIMIT', 'The deal exceeds the agent’s per-deal limit'],
  ['POLICY_DAILY_LIMIT', 'The deal would exceed the agent’s 24-hour limit'],
  ['POLICY_CATEGORY', 'The category isn’t in the agent’s mandate'],
  ['POLICY_COUNTERPARTY_SCORE', 'The counterparty’s Bond Score is below the agent’s minimum'],
  ['UNINSURABLE', 'The counterparty’s estimated fault probability is above the 35% ceiling'],
  ['POOL_CAPACITY', 'Reserve capital can’t back this coverage right now'],
  ['SELLER_CONCENTRATION', 'Too much coverage already sits on this seller'],
] as const;

const FEATURES = [
  ['Signed requests', 'Ed25519 over method, path, timestamp, nonce, body hash. Headers: X-Bond-Agent, -Timestamp, -Nonce, -Signature.'],
  ['Audit-only mode', 'Pass coverageCents: 0 to get the mandate and audit log with no premium. A good first step.'],
  ['Machine-readable refusals', 'Every decline carries stable codes your agent can branch on.'],
  ['Everything is hashed', 'Terms, deliveries and receipts are compared by SHA-256, so disputes are settled from evidence.'],
] as const;

export function Developers() {
  return (
    <>
      <section className="page-hero">
        <div className="container narrow">
          <p className="eyebrow">Developers</p>
          <h1>Guarded purchasing in a few lines.</h1>
          <p className="lead">
            The SDK handles keys, request signing, and the deal lifecycle. Your agent gets a clear yes, or a
            machine-readable no.
          </p>
          <div className="cta-row">
            <Link to="/waitlist" className="btn btn-primary">Request preview access</Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container split">
          <div>
            <h2>Buy safely</h2>
            <p className="section-lead">
              Register an agent with a mandate, then make a purchase. Bond checks your limits, assesses the seller,
              prices the bond, and records the terms.
            </p>
            <div className="grid-tight">
              {FEATURES.map(([t, d]) => <article className="card" key={t}><h3>{t}</h3><p>{d}</p></article>)}
            </div>
          </div>
          <CodeBlock code={BUYER} label="Buyer agent · TypeScript (preview)" />
        </div>
      </section>

      <section className="section alt">
        <div className="container split">
          <div>
            <h2>Sell with a reputation</h2>
            <p className="section-lead">
              Sellers accept a terms hash and attest what they delivered. Every clean delivery builds a score buyers can
              see and price against.
            </p>
          </div>
          <CodeBlock code={SELLER} label="Seller agent and disputes" />
        </div>
      </section>

      <section className="section">
        <div className="container narrow">
          <h2>Decline codes</h2>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
              <tbody>{CODES.map(([c, d]) => <tr key={c}><td><code>{c}</code></td><td>{d}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="muted small">
            The SDK is in private preview: TypeScript today, with a Python SDK and an MCP server for agent frameworks
            planned. Package names and APIs may change before general availability.
          </p>
        </div>
      </section>
    </>
  );
}
