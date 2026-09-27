import { Link } from 'react-router-dom';
import { Calculator } from '../components/Calculator';
import { CodeBlock } from '../components/CodeBlock';
import { DealCard } from '../components/DealCard';
import { Faq, type FaqItem } from '../components/Faq';

const PROBLEMS = [
  ['No identity that sticks', 'A misbehaving agent can spin up a new key in a second and start over with a clean record.'],
  ['No recourse', 'When a counterparty agent takes payment and never delivers, nobody knows who is responsible or who pays.'],
  ['No guardrails you can prove', 'Finance won’t hand an agent a budget without limits, logs, and someone to hold accountable.'],
] as const;

const PILLARS = [
  ['Identity & audit ledger', 'Every agent signs its actions with its own key. Every action lands in a hash-chained log, so history can’t be quietly rewritten.'],
  ['Bond Score', 'A 0–1000 reputation built from real outcomes: weighted by deal value, faded over time, and hard to farm with fake trades.'],
  ['Bonded deals', 'A live price to insure one specific deal, based on the counterparty’s track record. Some risks are declined at any price.'],
  ['Automated disputes', 'An arbiter reads both sides’ signed evidence and settles clear cases in milliseconds. Ambiguous ones go to a human.'],
] as const;

const STEPS = [
  ['Quote', 'Your agent asks to buy. Bond checks its mandate and the seller’s risk, then returns a price or a refusal.'],
  ['Bond', 'The exact terms are hashed and recorded. The premium is charged and coverage is reserved.'],
  ['Accept & pay', 'The seller accepts that exact terms hash. The buyer pays.'],
  ['Deliver & confirm', 'The seller signs a hash of what it delivered. The buyer signs a hash of what it received.'],
  ['Settle or dispute', 'Matching hashes settle the deal. A failure goes to the arbiter, and valid claims are paid.'],
] as const;

const SIM_ROWS = [
  ['Reliable, verified sellers', 'Tier A (≈870–900)', 'Cheap bonds'],
  ['Sloppy seller (scripted to fail ≈22% of deals)', 'Tier C (≈610)', 'Expensive bonds'],
  ['Scammer (≈70% of deals fail)', 'Tier E (≈360)', 'Declined as uninsurable'],
  ['Buyer that files false claims', 'Tier D (≈460)', 'Claims denied from its own signed receipts'],
  ['Two agents wash-trading each other', 'Held at tier B (≈800)', 'Can’t buy their way to the top'],
] as const;

const FAQ: FaqItem[] = [
  {
    q: 'Is Bond insurance?',
    a: 'Paying out when a deal fails is regulated as insurance or surety in most places. Our plan is to offer coverage through licensed partners. Today Bond is a working prototype that runs on simulated funds, so no real money moves and no real coverage is in force.',
  },
  {
    q: 'Does Bond hold my money or my agents’ keys?',
    a: 'No, by design. Bond only ever stores public keys; private keys stay with you. Payments are planned to run through a licensed payments partner rather than Bond holding funds.',
  },
  {
    q: 'What if an agent lies about delivering?',
    a: 'Delivery is proven with hashes: the seller signs what it says it delivered and the buyer signs what it received, and both are compared with the agreed spec. When the two sides genuinely conflict, the case goes to a human reviewer instead of being guessed. Physical goods and subjective quality need third-party attestations, which are on our roadmap.',
  },
  {
    q: 'Can agents game the score?',
    a: 'We’ve built in defences: outcomes are weighted by deal value, no single counterparty can contribute more than a fixed amount, and recent behaviour counts most. Fake trades also cost real premiums. No reputation system is unbreakable, so we treat this as an ongoing monitoring problem.',
  },
  {
    q: 'What frameworks does it work with?',
    a: 'Anything that can make signed HTTPS calls. A TypeScript SDK exists in the prototype. A Python SDK and an MCP server for agent frameworks are planned.',
  },
  {
    q: 'When can I use it?',
    a: 'Bond is in private preview by invitation. Join the waitlist and we’ll reach out.',
  },
];

const SNIPPET = `const bond = await BondClient.register({
  name: 'ProcureBot', owner: 'Acme Corp',
  policy: { perTxLimitCents: 50_000, allowedCategories: ['data'] },
});

try {
  const { transaction } = await bond.purchase({
    counterparty: sellerId,
    spec: '10k rows of EU pricing data',
    priceCents: 12_000,
    category: 'data',
  });
  await bond.pay(transaction);
} catch (e) {
  // BondDeclined: POLICY_PER_TX_LIMIT, UNINSURABLE, ...
}`;

export function Home() {
  return (
    <>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <p className="eyebrow">Trust infrastructure for the agent economy</p>
            <h1>Let your AI agents do business with strangers. <span className="accent">Safely.</span></h1>
            <p className="lead">
              Bond gives every agent a verifiable identity, a reputation score, and coverage when a deal goes wrong,
              with an owner-set spending mandate on top.
            </p>
            <div className="cta-row">
              <Link to="/waitlist" className="btn btn-primary">Join the waitlist</Link>
              <Link to="/how-it-works" className="btn btn-ghost">See how it works</Link>
            </div>
            <p className="muted small">Private preview · TypeScript SDK · Python and MCP planned</p>
          </div>
          <DealCard />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Agents are starting to transact. The trust layer doesn’t exist yet.</h2>
          <p className="section-lead">
            People have IDs, credit histories, reputations to lose, and courts. A software agent that can be created in
            a second has none of these.
          </p>
          <div className="grid3">
            {PROBLEMS.map(([t, d]) => (
              <article className="card" key={t}><h3>{t}</h3><p>{d}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <h2>Four pieces that make an agent deal trustworthy</h2>
          <div className="grid4">
            {PILLARS.map(([t, d], i) => (
              <article className="card pillar" key={t}>
                <span className="num">{String(i + 1).padStart(2, '0')}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </article>
            ))}
          </div>
          <div className="banner">
            <div>
              <h3>Owner mandates, enforced server-side</h3>
              <p>
                Set per-deal and daily limits, allowed categories, and a minimum counterparty score. A confused or
                compromised agent can’t exceed them, and every blocked attempt is logged for audit.
              </p>
            </div>
            <Link to="/security" className="btn btn-ghost">How it’s secured</Link>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>How a bonded deal works</h2>
          <ol className="steps">
            {STEPS.map(([t, d], i) => (
              <li key={t}><span className="step-n">{i + 1}</span><h3>{t}</h3><p>{d}</p></li>
            ))}
          </ol>
          <p><Link to="/how-it-works" className="link">Full walkthrough and arbiter rules →</Link></p>
        </div>
      </section>

      <section className="section alt" id="calculator">
        <div className="container">
          <h2>See how risk becomes a price</h2>
          <p className="section-lead">
            Pick a seller’s track record and a deal. Bond turns it into a score, a fault probability, and a premium, or
            declines it.
          </p>
          <Calculator />
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Stress-tested against bad actors</h2>
          <p className="section-lead">
            We simulated 45 days of an agent marketplace: 19 agents, about 480 deals, with scripted scammers, false
            claimers and wash traders.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Who</th><th>What happened to their score</th><th>Outcome</th></tr></thead>
              <tbody>
                {SIM_ROWS.map(([who, score, out]) => (
                  <tr key={who}><td>{who}</td><td>{score}</td><td>{out}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Synthetic agents with scripted behaviour. This shows the mechanism works, not what real-world failure rates
            will be. Calibrating against real outcomes is the point of the private preview.
          </p>
        </div>
      </section>

      <section className="section alt">
        <div className="container split">
          <div>
            <h2>Built for developers</h2>
            <p className="section-lead">
              One call checks the mandate, assesses the counterparty, and bonds the deal. If it should not go ahead, you
              get a machine-readable reason.
            </p>
            <p><Link to="/developers" className="link">Developer overview →</Link></p>
          </div>
          <CodeBlock code={SNIPPET} label="TypeScript SDK (preview)" />
        </div>
      </section>

      <section className="section">
        <div className="container narrow">
          <h2>Questions</h2>
          <Faq items={FAQ} />
        </div>
      </section>

      <section className="section cta-final">
        <div className="container center">
          <h2>Be early to the agent trust layer.</h2>
          <p className="section-lead">Private preview for teams building agents that buy or sell.</p>
          <Link to="/waitlist" className="btn btn-primary">Join the waitlist</Link>
        </div>
      </section>
    </>
  );
}
