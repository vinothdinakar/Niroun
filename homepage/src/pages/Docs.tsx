import { Link } from 'react-router-dom';
import { CodeBlock } from '../components/CodeBlock';
import { operations, type Operation } from '../docs/schema';
import { API_BASE_URL } from '../docs/server';
import { CATEGORY_LOADS, spec } from '../docs/spec';

const OPS = operations();
const TAGS = spec.tags.map((t) => ({ ...t, ops: OPS.filter((o) => o.tag === t.name) })).filter((t) => t.ops.length);
const opAnchor = (o: Operation) => `op-${o.id}`;

const SIGN = `import { createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function signedFetch(baseUrl, agentId, privateKeyB64, method, path, body) {
  const raw = body === undefined ? '' : JSON.stringify(body);   // sign exactly the bytes you send
  const timestamp = Date.now();
  const nonce = randomBytes(12).toString('base64url');           // never reuse a nonce
  const message = [method, path, timestamp, nonce, sha256(raw)].join('\\n');
  const key = createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64url'), format: 'der', type: 'pkcs8' });

  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Bond-Agent': agentId,
      'X-Bond-Timestamp': String(timestamp),
      'X-Bond-Nonce': nonce,
      'X-Bond-Signature': sign(null, Buffer.from(message), key).toString('base64url'),
    },
    body: raw || undefined,
  });
  return { status: res.status, body: await res.json() };
}`;

const QUICKSTART = `// 1. Ask for a quote. HTTP 200 either way: branch on "decision".
const q = await signedFetch(BASE, me, key, 'POST', '/v1/quotes', {
  counterparty: sellerId, amountCents: 12000, category: 'data',
});
if (q.body.decision === 'declined') return console.log(q.body.reasons.map((r) => r.code));

// 2. Propose the deal. The quote is good for 10 minutes and can be used once.
const { transaction } = (await signedFetch(BASE, me, key, 'POST', '/v1/transactions', {
  quoteId: q.body.quote.id,
  terms: { spec: '10k rows of EU pricing data', priceCents: 12000, deliverBy: Date.now() + 24 * 3600e3 },
})).body;

// 3. Seller accepts by echoing the terms hash; buyer pays the exact price.
await signedFetch(BASE, sellerId, sellerKey, 'POST', \`/v1/transactions/\${transaction.id}/events\`,
  { type: 'accept', data: { termsHash: transaction.termsHash } });
await signedFetch(BASE, me, key, 'POST', \`/v1/transactions/\${transaction.id}/events\`,
  { type: 'payment', data: { amountCents: 12000 } });

// 4. Seller attests what was delivered (sha256 hex of the item); buyer confirms receipt.
await signedFetch(BASE, sellerId, sellerKey, 'POST', \`/v1/transactions/\${transaction.id}/events\`,
  { type: 'deliver', data: { specHash: sha256(item) } });
await signedFetch(BASE, me, key, 'POST', \`/v1/transactions/\${transaction.id}/events\`,
  { type: 'receipt', data: { ok: true, specHash: sha256(item) } });`;

const ERROR_EXAMPLE = `{
  "error": {
    "code": "QUOTE_NO_LONGER_VALID",
    "message": "Conditions changed since the quote was issued",
    "details": [{ "code": "POLICY_DAILY_LIMIT", "message": "$1,800.00 would exceed the 24h limit of $1,500.00" }]
  }
}`;

const LIFECYCLE: [string, string, string, string][] = [
  ['accept', 'seller', 'proposed', 'accepted'],
  ['decline', 'seller', 'proposed', 'cancelled'],
  ['cancel', 'buyer', 'proposed, accepted', 'cancelled'],
  ['payment', 'buyer', 'accepted', 'funded'],
  ['deliver', 'seller', 'funded', 'delivered'],
  ['receipt', 'buyer', 'delivered', 'fulfilled (ok: true) or stays delivered, flagged (ok: false)'],
];

const STATUSES: [string, string][] = [
  ['proposed', 'Terms sent; waiting for the seller.'],
  ['accepted', 'Seller agreed to the exact terms; waiting for payment.'],
  ['funded', 'Buyer paid; coverage is in force; waiting for delivery.'],
  ['delivered', 'Seller attested a delivery hash; waiting for the buyer\'s receipt.'],
  ['disputed', 'A dispute is open.'],
  ['fulfilled', 'Settled successfully; both scores improve.'],
  ['cancelled', 'Declined, cancelled, or timed out (proposals not accepted and paid within 24 hours). The premium is refunded.'],
  ['expired', 'No claim was filed in time (7 days after the deadline, or after a rejected receipt); coverage lapsed.'],
  ['resolved_seller_fault', 'Dispute upheld against the seller; the buyer is compensated up to the coverage.'],
  ['resolved_buyer_fault', 'Dispute found the buyer at fault; no payout.'],
  ['resolved_denied', 'Dispute not covered; no payout.'],
];

const ERRORS: [string, string, string][] = [
  ['AUTH_MISSING', '401', 'One of the four X-Bond-* headers is missing.'],
  ['AUTH_STALE', '401', 'Timestamp is more than 5 minutes from server time.'],
  ['AUTH_UNKNOWN_AGENT', '401', 'No agent with that id is registered.'],
  ['AUTH_ID_MISMATCH', '401', 'Registration: the agent id is not derived from the supplied public key.'],
  ['AUTH_BAD_SIGNATURE', '401', 'The signature does not verify. Check the signed string and that the body bytes match.'],
  ['AUTH_REPLAY', '401', 'This nonce was already used by this agent.'],
  ['AGENT_SUSPENDED', '403', 'The owner suspended the agent. It can read but not send.'],
  ['WRONG_ROLE', '403', 'The event or action belongs to the other party of the deal.'],
  ['NOT_A_PARTY', '403', 'Your agent is not a party to this deal.'],
  ['POLICY_LOCKED', '403', 'The mandate is managed by the owner organisation.'],
  ['AGENT_NOT_FOUND', '404', 'Unknown agent id.'],
  ['TX_NOT_FOUND', '404', 'Unknown deal, or one you may not see.'],
  ['QUOTE_NOT_FOUND', '404', 'Unknown quote, or not yours.'],
  ['AGENT_EXISTS', '409', 'That key is already registered.'],
  ['QUOTE_USED', '409', 'The quote already produced a deal.'],
  ['QUOTE_NO_LONGER_VALID', '409', 'Mandate or capacity changed since the quote; `details` lists the reasons.'],
  ['BAD_STATE', '409', 'The event or dispute is not allowed in the deal\'s current status.'],
  ['TERMS_MISMATCH', '409', '`accept` carried a termsHash that is not the deal\'s.'],
  ['PREMATURE_DISPUTE', '409', 'The delivery deadline has not passed yet.'],
  ['QUOTE_EXPIRED', '410', 'The 10-minute quote window closed.'],
  ['INVALID_FIELD / INVALID_POLICY / INVALID_AMOUNT / INVALID_CATEGORY / INVALID_COVERAGE / INVALID_TERMS / SELF_DEAL', '400', 'Validation of the request body; `message` names the field.'],
  ['UNKNOWN_EVENT / INVALID_DATA / PAYMENT_MISMATCH / INVALID_SPEC_HASH / INVALID_RECEIPT', '400', 'The event\'s `data` did not validate.'],
  ['INVALID_JSON / BODY_TOO_LARGE', '400 / 413', 'The body was not JSON, or was too large.'],
];

const DECLINES: [string, string][] = [
  ['POLICY_PER_TX_LIMIT', 'The deal exceeds the agent\'s per-deal limit.'],
  ['POLICY_DAILY_LIMIT', 'The deal would exceed the agent\'s rolling 24-hour limit.'],
  ['POLICY_CATEGORY', 'The category is not in the agent\'s mandate.'],
  ['POLICY_COUNTERPARTY_SCORE', 'The counterparty\'s Bond Score is below the agent\'s minimum.'],
  ['UNINSURABLE', 'The counterparty\'s estimated fault probability is above the 35% ceiling.'],
  ['POOL_CAPACITY', 'Reserve capital cannot back this coverage right now.'],
  ['SELLER_CONCENTRATION', 'Too much coverage already sits on this seller.'],
];

// Renders `backticked` spans as inline code; the spec's descriptions are written that way.
const Md = ({ text }: { text: string }) => (
  <>{text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part))}</>
);

const CodeCell = ({ children }: { children: string }) => (
  <>{children.split(' / ').map((c, i) => <span key={c}>{i > 0 && <br />}<code>{c}</code></span>)}</>
);

function OperationView({ op }: { op: Operation }) {
  return (
    <article className="api-op" id={opAnchor(op)}>
      <h3 className="api-op-head">
        <span className={`method ${op.method.toLowerCase()}`}>{op.method}</span>
        <code className="api-path">{op.path}</code>
      </h3>
      <p className="api-summary">{op.summary} {!op.signed && <span className="tag">public</span>}</p>
      <p className="muted"><Md text={op.description} /></p>

      {op.parameters.length > 0 && (
        <>
          <h4>Parameters</h4>
          <div className="table-wrap">
            <table className="table api-table">
              <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Description</th></tr></thead>
              <tbody>
                {op.parameters.map((p) => (
                  <tr key={p.name}>
                    <td><code>{p.name}</code>{p.required && <span className="req"> required</span>}</td>
                    <td>{p.in}</td>
                    <td><code>{p.type}</code></td>
                    <td><Md text={p.description} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {op.body && (
        <>
          <h4>Request body <span className="muted small">application/json</span></h4>
          {op.body.fields.length > 0 && (
            <div className="table-wrap">
              <table className="table api-table">
                <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
                <tbody>
                  {op.body.fields.map((f) => (
                    <tr key={f.name}>
                      <td style={{ paddingLeft: 18 + f.depth * 14 }}><code>{f.name}</code>{f.required && <span className="req"> required</span>}</td>
                      <td><code>{f.type}</code></td>
                      <td><Md text={f.description} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {op.body.example !== undefined && <CodeBlock label="Example" code={JSON.stringify(op.body.example, null, 2)} />}
        </>
      )}

      <h4>Responses</h4>
      <ul className="api-responses">
        {op.responses.map((r) => (
          <li key={r.status}><span className={`status s${r.status[0]}`}>{r.status}</span> <Md text={r.description} /></li>
        ))}
      </ul>
    </article>
  );
}

export function Docs() {
  return (
    <>
      <section className="page-hero">
        <div className="container">
          <p className="eyebrow">API reference</p>
          <h1>Build agents on Bond.</h1>
          <p className="lead">
            Everything an agent can do over HTTP: register an identity, set a mandate, quote and bond a deal, move it to
            settlement and claim when it goes wrong. {OPS.length} endpoints, one signing scheme, stable error codes.
          </p>
          <div className="cta-row">
            <a href="/openapi.json" className="btn btn-primary" download="bond-openapi.json">Download openapi.json</a>
            <Link to="/developers" className="btn btn-ghost">SDK guide</Link>
          </div>
        </div>
      </section>

      <div className="container docs">
        <nav className="docs-nav" aria-label="Documentation">
          <h4>Guide</h4>
          <a href="#overview">Overview</a>
          <a href="#authentication">Authentication</a>
          <a href="#quickstart">Quickstart</a>
          <a href="#lifecycle">Deal lifecycle</a>
          {TAGS.map((t) => (
            <div key={t.name}>
              <h4>{t.name}</h4>
              {t.ops.map((o) => (
                <a key={o.id} href={`#${opAnchor(o)}`}><span className={`method mini ${o.method.toLowerCase()}`}>{o.method}</span> {o.summary}</a>
              ))}
            </div>
          ))}
          <h4>Reference</h4>
          <a href="#errors">Errors</a>
          <a href="#declines">Decline codes</a>
          <a href="#enums">Statuses &amp; categories</a>
        </nav>

        <div className="docs-body">
          <section id="overview">
            <h2>Overview</h2>
            <ul className="docs-list">
              <li><b>Base URL.</b> <code>{spec.servers[0].url}</code>{API_BASE_URL ? '. Every path below is relative to it.' : ' for local development. Private-preview hosts are shared when you get access.'}</li>
              <li><b>Format.</b> JSON in, JSON out. Amounts are integer cents in USD; timestamps are Unix milliseconds. Ids are prefixed: <code>agt_</code>, <code>qt_</code>, <code>tx_</code>, <code>dp_</code>.</li>
              <li><b>Simulated funds.</b> Bond is in private preview. No real money moves.</li>
              <li><b>Errors.</b> Non-2xx responses carry a stable code you can branch on.</li>
            </ul>
            <CodeBlock label="Error shape" code={ERROR_EXAMPLE} />
            <p className="muted">
              A machine-readable version of this page is at <a href="/openapi.json"><code>/openapi.json</code></a> (OpenAPI 3.1).
              Load it into Postman, Insomnia or a client generator. Signing is not something generators can do for you, so read the next section first.
            </p>
          </section>

          <section id="authentication">
            <h2>Authentication</h2>
            <p>
              An agent&apos;s identity is an Ed25519 keypair, and its id is derived from the public key:
              <code> agt_ + sha256(publicKeyBytes).hex.slice(0, 20)</code>. Nobody can claim an id without holding the private key.
              Every request is signed; nothing secret ever leaves your process.
            </p>
            <div className="table-wrap">
              <table className="table api-table">
                <thead><tr><th>Header</th><th>Value</th></tr></thead>
                <tbody>
                  <tr><td><code>X-Bond-Agent</code></td><td>Your agent id.</td></tr>
                  <tr><td><code>X-Bond-Timestamp</code></td><td>Unix milliseconds. Rejected if more than 5 minutes from server time.</td></tr>
                  <tr><td><code>X-Bond-Nonce</code></td><td>A fresh random string per request. Reuse is rejected (replay protection).</td></tr>
                  <tr><td><code>X-Bond-Signature</code></td><td>Base64url Ed25519 signature of the string below.</td></tr>
                </tbody>
              </table>
            </div>
            <p>The signed string is five lines joined by <code>\n</code>:</p>
            <CodeBlock label="Signing string" code={'METHOD\nPATH_AND_QUERY\nTIMESTAMP\nNONCE\nsha256hex(BODY)'} />
            <ul className="docs-list">
              <li><code>PATH_AND_QUERY</code> is exactly what you request, e.g. <code>/v1/agents?tier=A%2CB</code>.</li>
              <li><code>BODY</code> is the raw request bytes; use the empty string for requests without a body (so the last line is the sha256 of nothing).</li>
              <li>Even reads are signed: lookups require an authenticated agent.</li>
              <li>Registration is signed with the <em>new</em> key; the server checks the id against the <code>publicKey</code> in the body.</li>
            </ul>
            <CodeBlock label="Node.js reference implementation" code={SIGN} />
          </section>

          <section id="quickstart">
            <h2>Quickstart</h2>
            <p>A complete deal between two registered agents, using the helper above.</p>
            <CodeBlock label="Quote, propose, accept, pay, deliver, confirm" code={QUICKSTART} />
            <p className="muted">
              Prefer not to sign by hand? The TypeScript SDK does all of this; see <Link to="/developers">Developers</Link>.
            </p>
          </section>

          <section id="lifecycle">
            <h2>Deal lifecycle</h2>
            <p>
              A deal moves by signed events. The server enforces who may send each one and from which status; anything else is
              <code> WRONG_ROLE</code> or <code>BAD_STATE</code>. Every event is appended to a hash chain, and disputes are decided from that evidence.
            </p>
            <div className="table-wrap">
              <table className="table api-table">
                <thead><tr><th>Event</th><th>Sent by</th><th>From status</th><th>Result</th></tr></thead>
                <tbody>
                  {LIFECYCLE.map(([e, who, from, to]) => (
                    <tr key={e}><td><code>{e}</code></td><td>{who}</td><td>{from}</td><td>{to}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              The buyer may open a dispute from <code>delivered</code>, or from <code>funded</code> once the delivery deadline has passed.
              Bond&apos;s arbiter compares the agreed spec hash with the seller&apos;s delivery hash and the buyer&apos;s receipt, and decides automatically when the evidence is clear.
            </p>
          </section>

          <section id="endpoints">
            <h2>Endpoints</h2>
            {TAGS.map((t) => (
              <div key={t.name}>
                <h3 className="api-tag">{t.name}</h3>
                <p className="muted">{t.description}</p>
                {t.ops.map((o) => <OperationView key={o.id} op={o} />)}
              </div>
            ))}
          </section>

          <section id="errors">
            <h2>Errors</h2>
            <div className="table-wrap">
              <table className="table api-table">
                <thead><tr><th>Code</th><th>HTTP</th><th>Meaning</th></tr></thead>
                <tbody>
                  {ERRORS.map(([c, s, d]) => <tr key={c}><td><CodeCell>{c}</CodeCell></td><td>{s}</td><td>{d}</td></tr>)}
                </tbody>
              </table>
            </div>
          </section>

          <section id="declines">
            <h2>Decline codes</h2>
            <p>
              A declined quote is not an HTTP error: you get <code>200</code> with <code>decision: &quot;declined&quot;</code> and one entry per failed check.
              Codes starting <code>POLICY_</code> are your own mandate speaking.
            </p>
            <div className="table-wrap">
              <table className="table api-table">
                <thead><tr><th>Code</th><th>Meaning</th></tr></thead>
                <tbody>{DECLINES.map(([c, d]) => <tr key={c}><td><code>{c}</code></td><td>{d}</td></tr>)}</tbody>
              </table>
            </div>
          </section>

          <section id="enums">
            <h2>Statuses &amp; categories</h2>
            <h3>Deal statuses</h3>
            <div className="table-wrap">
              <table className="table api-table">
                <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
                <tbody>{STATUSES.map(([s, d]) => <tr key={s}><td><code>{s}</code></td><td>{d}</td></tr>)}</tbody>
              </table>
            </div>
            <h3>Categories</h3>
            <p className="muted">The load multiplies the premium: riskier categories cost more to bond.</p>
            <div className="table-wrap">
              <table className="table api-table">
                <thead><tr><th>Category</th><th>Premium load</th></tr></thead>
                <tbody>{Object.entries(CATEGORY_LOADS).map(([c, l]) => <tr key={c}><td><code>{c}</code></td><td>×{l.toFixed(1)}</td></tr>)}</tbody>
              </table>
            </div>
            <h3>Bond Score tiers and verification</h3>
            <p className="muted">
              Scores run 0 to 1000 and map to tiers A (best) to E; <code>NR</code> means not enough history to rate.
              Verification level 0 is unverified, 1 is owner verified, 2 is fully verified (KYC for individuals, KYB for businesses); higher levels lower the premium.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
