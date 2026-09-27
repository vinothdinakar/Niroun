import { Link } from 'react-router-dom';
import { quote, usd, pct } from '../lib/risk';

// Illustrative bond prices are generated from the same model as the calculator, so this
// table can't drift from what the model would quote.
const EXAMPLES = [
  { who: 'Proven, verified seller', history: { fulfilled: 40, faults: 2, verification: 2 as const } },
  { who: 'Established seller', history: { fulfilled: 60, faults: 4, verification: 1 as const } },
  { who: 'New, unverified seller', history: { fulfilled: 0, faults: 0, verification: 0 as const } },
  { who: 'Unreliable seller (20 of 60 deals failed)', history: { fulfilled: 40, faults: 20, verification: 0 as const } },
  { who: 'Serial defaulter', history: { fulfilled: 5, faults: 15, verification: 0 as const } },
].map((e) => ({ ...e, q: quote({ ...e.history, category: 'digital_goods', amountUsd: 500 }) }));

const PLANS = [
  {
    name: 'Guardrails',
    price: 'Free',
    tag: 'For any team running agents that spend',
    items: ['Agent identity and signed requests', 'Tamper-evident audit log', 'Spending mandates: limits, categories, counterparty rules', 'Audit-only mode: no coverage, no premium'],
  },
  {
    name: 'Score API',
    price: 'Usage-based',
    tag: 'For marketplaces and agent platforms',
    items: ['Look up any agent’s Bond Score and history', 'Embed trust signals in listings', 'Webhooks on score changes'],
    note: 'Pricing to be announced in the preview.',
  },
  {
    name: 'Bonded deals',
    price: 'Per-deal premium',
    tag: 'For deals that need recourse',
    items: ['Live-quoted coverage on a specific deal', 'Automated claims and dispute resolution', 'Reserve-backed, with concentration limits'],
    note: 'Offered through licensed partners at launch.',
    featured: true,
  },
];

export function Pricing() {
  return (
    <>
      <section className="page-hero">
        <div className="container narrow">
          <p className="eyebrow">Pricing</p>
          <h1>Start free. Pay for risk only when you take it.</h1>
          <p className="lead">
            Guardrails cost nothing. Bonds are priced live, per deal, from the counterparty’s actual track record.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid3">
            {PLANS.map((p) => (
              <article className={p.featured ? 'card plan featured' : 'card plan'} key={p.name}>
                <h3>{p.name}</h3>
                <div className="price">{p.price}</div>
                <p className="muted">{p.tag}</p>
                <ul>{p.items.map((i) => <li key={i}>{i}</li>)}</ul>
                {p.note && <p className="muted small">{p.note}</p>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <h2>What a bond costs</h2>
          <p className="section-lead">
            Premium = coverage × the seller’s estimated fault probability × a margin, adjusted for category and deal
            size. Better track records and verified owners pay less. Risks above a 35% fault probability are declined.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Seller</th><th>Bond Score</th><th>Fault probability</th><th>Premium on a $500 digital deal</th></tr>
              </thead>
              <tbody>
                {EXAMPLES.map((e) => (
                  <tr key={e.who}>
                    <td>{e.who}</td>
                    <td><span className={`tier tier-${e.q.tier}`}>{e.q.tier}</span> {e.q.score}</td>
                    <td>{pct(e.q.pd)}</td>
                    <td>{e.q.declined ? <span className="bad">Declined: uninsurable</span> : `${usd(e.q.premiumUsd)} (${pct(e.q.rate, 2)})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Illustrative output of the prototype’s model, with simplified assumptions. Real prices are quoted per deal,
            will be recalibrated on real outcomes, and are subject to launch terms with our licensed partners.
          </p>
          <p><Link to="/#calculator" className="link">Try the interactive calculator on the home page →</Link></p>
        </div>
      </section>

      <section className="section">
        <div className="container center">
          <h2>Want to price your own deal flow?</h2>
          <p className="section-lead">Tell us what your agents buy or sell and we’ll model it with you during the preview.</p>
          <Link to="/waitlist" className="btn btn-primary">Join the waitlist</Link>
        </div>
      </section>
    </>
  );
}
