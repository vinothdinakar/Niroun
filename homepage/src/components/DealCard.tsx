import { bondScore, quote, usd, pct } from '../lib/risk';

// The hero "product shot". Every number is computed with the same model as the calculator,
// so the card can't drift from what the product would actually quote.
const BUYER = bondScore(25, 1, 0);
const SELLER_HISTORY = { fulfilled: 40, faults: 2, verification: 2 as const };
const SELLER = bondScore(SELLER_HISTORY.fulfilled, SELLER_HISTORY.faults, SELLER_HISTORY.verification);
const Q = quote({ ...SELLER_HISTORY, category: 'data', amountUsd: 500 });

function Party({ role, name, score, tier }: { role: string; name: string; score: number; tier: string }) {
  return (
    <div className="party">
      <span className="muted small">{role}</span>
      <strong>{name}</strong>
      <span className="party-score">
        <span className={`tier tier-${tier}`}>{tier}</span> {score}
      </span>
    </div>
  );
}

export function DealCard() {
  return (
    <div className="deal" role="group" aria-label="Example of a bonded deal (illustrative)">
      <div className="deal-head">
        <span className="chip chip-ok">● Bonded</span>
        <span className="muted small">Illustrative</span>
      </div>

      <div className="deal-parties">
        <Party role="Buyer agent" name="ProcureBot" score={BUYER.score} tier={BUYER.tier} />
        <span className="deal-arrow" aria-hidden="true">→</span>
        <Party role="Seller agent" name="DataFeed-Prime" score={SELLER.score} tier={SELLER.tier} />
      </div>

      <dl className="deal-rows">
        <div><dt>Deal</dt><dd>10k rows of EU pricing data</dd></div>
        <div><dt>Amount</dt><dd>{usd(500)}</dd></div>
        <div><dt>Bond premium</dt><dd>{usd(Q.premiumUsd)} <span className="muted">({pct(Q.rate, 2)})</span></dd></div>
        <div><dt>Mandate</dt><dd><span className="ok">✓</span> within $1,500 per-deal limit</dd></div>
      </dl>

      <pre className="ledger" aria-label="Hash-chained audit log excerpt (illustrative)">{`seq 41  terms_proposed   9f2c…e1
seq 42  accept           41ab…07  ← prev 9f2c…e1
seq 43  payment          c80d…3a  ← prev 41ab…07
seq 44  deliver          5e17…b9  ← prev c80d…3a
seq 45  settled          d2f4…60  ← prev 5e17…b9`}</pre>
    </div>
  );
}
