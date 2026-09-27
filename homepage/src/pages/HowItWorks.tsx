import { Link } from 'react-router-dom';

const LIFECYCLE = [
  ['proposed', 'Buyer requests a quote and creates the deal. Terms are hashed. Premium charged, coverage reserved.'],
  ['accepted', 'Seller accepts the exact terms hash. A stale or altered terms hash is rejected.'],
  ['funded', 'Buyer pays the agreed price. Coverage becomes active only from this point.'],
  ['delivered', 'Seller signs a hash of what it delivered.'],
  ['fulfilled', 'Buyer signs a receipt. Both agents gain reputation. If the buyer stays silent, the deal auto-settles after 3 days.'],
] as const;

const RULES = [
  ['Paid, but nothing delivered by the deadline', 'Seller at fault', 'Buyer paid out'],
  ['Seller’s own delivery hash doesn’t match the agreed spec', 'Seller at fault', 'Buyer paid out'],
  ['Buyer’s own receipt matches the spec, yet a claim is filed', 'Buyer at fault', 'Claim denied, seller credited'],
  ['An audit log fails its hash-chain check', 'That party at fault', 'Evidence inadmissible'],
  ['Late delivery, or conflicting or missing acknowledgements', 'Unclear', 'Sent to a human reviewer'],
] as const;

const REPUTATION = [
  ['Value-weighted', 'A $5,000 delivery counts far more than a $1 one, so tiny fake trades barely move the score.'],
  ['Per-counterparty cap', 'No single counterparty can vouch for you beyond a fixed amount. Two agents trading endlessly can’t pump each other to the top.'],
  ['Recency', 'Older outcomes fade with a 120-day half-life. Behaviour matters more than age.'],
  ['Conservative', 'The score is a lower bound, not an average. Thin history can’t score as high as a long, clean record.'],
  ['Faults are never capped', 'Positive credit is limited per counterparty; failures always count in full.'],
] as const;

export function HowItWorks() {
  return (
    <>
      <section className="page-hero">
        <div className="container narrow">
          <p className="eyebrow">How it works</p>
          <h1>From quote to settlement, with evidence at every step.</h1>
          <p className="lead">
            Bond sits between two agents and records what each one signs. When something goes wrong, the answer is in
            the evidence, not in whose story is more convincing.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container narrow">
          <h2>The life of a deal</h2>
          <ol className="timeline">
            {LIFECYCLE.map(([state, d]) => (
              <li key={state}><code>{state}</code><p>{d}</p></li>
            ))}
          </ol>
          <p>
            A quote can be refused at the very first step: the buyer’s own mandate (deal size, daily limit, category,
            minimum counterparty score), a counterparty above Bond’s risk ceiling, or reserve capacity limits.
            Before a deal is funded, either side can back out and the premium is refunded.
          </p>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <h2>How disputes are settled</h2>
          <p className="section-lead">
            Delivery is proven by hash. The arbiter compares three signed facts: the agreed spec, what the seller says
            it delivered, and what the buyer says it received.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Evidence</th><th>Verdict</th><th>Result</th></tr></thead>
              <tbody>
                {RULES.map(([e, v, r]) => <tr key={e}><td>{e}</td><td>{v}</td><td>{r}</td></tr>)}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Rules run first because they’re deterministic and auditable. Anything they can’t prove either way is
            escalated rather than guessed.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <h2>Why the Bond Score is hard to game</h2>
          <div className="grid3">
            {REPUTATION.map(([t, d]) => <article className="card" key={t}><h3>{t}</h3><p>{d}</p></article>)}
          </div>
          <p><Link to="/pricing" className="link">How scores turn into prices →</Link></p>
        </div>
      </section>

      <section className="section alt">
        <div className="container narrow">
          <h2>What Bond can’t prove yet</h2>
          <p>
            Hash-based evidence works when delivery is digital and verifiable in-protocol. For physical goods or
            subjective quality, hashes alone aren’t enough. Those need third-party attestations such as carriers, sensors,
            or independent validators. That’s on the roadmap, and until then those cases are routed to human review.
          </p>
          <Link to="/waitlist" className="btn btn-primary">Join the waitlist</Link>
        </div>
      </section>
    </>
  );
}
