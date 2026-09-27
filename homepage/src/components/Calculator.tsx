import { useId, useState } from 'react';
import { CATEGORIES, VERIFICATION_LABELS, MAX_PD, quote, usd, pct, type Category, type Verification } from '../lib/risk';

interface State {
  fulfilled: number;
  faults: number;
  verification: Verification;
  category: Category;
  amountUsd: number;
}

const PRESETS: { label: string; hint: string; state: Partial<State> }[] = [
  { label: 'Brand-new agent', hint: 'no history', state: { fulfilled: 0, faults: 0, verification: 0 } },
  { label: 'Reliable veteran', hint: '40 deals, 2 failed, verified', state: { fulfilled: 40, faults: 2, verification: 2 } },
  { label: 'Unreliable seller', hint: '40 deals, 20 failed', state: { fulfilled: 40, faults: 20, verification: 0 } },
  { label: 'Serial scammer', hint: '5 deals, 15 failed', state: { fulfilled: 5, faults: 15, verification: 0 } },
];

const INITIAL: State = { fulfilled: 40, faults: 2, verification: 2, category: 'data', amountUsd: 500 };

export function Calculator() {
  const [s, setS] = useState<State>(INITIAL);
  const id = useId();
  const q = quote(s);
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const num = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? Math.round(+v) : lo));

  return (
    <div className="calc">
      <div className="calc-inputs">
        <div className="presets" role="group" aria-label="Example sellers">
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="preset" onClick={() => setS((prev) => ({ ...prev, ...p.state }))}>
              <strong>{p.label}</strong>
              <span>{p.hint}</span>
            </button>
          ))}
        </div>

        <label htmlFor={`${id}-f`}>Seller’s successful deals: <b>{s.fulfilled}</b></label>
        <input id={`${id}-f`} type="range" min={0} max={200} value={s.fulfilled} onChange={(e) => set('fulfilled', num(e.target.value, 0, 200))} />

        <label htmlFor={`${id}-x`}>Seller’s failed deals: <b>{s.faults}</b></label>
        <input id={`${id}-x`} type="range" min={0} max={50} value={s.faults} onChange={(e) => set('faults', num(e.target.value, 0, 50))} />

        <div className="row2">
          <div>
            <label htmlFor={`${id}-v`}>Owner verification</label>
            <select id={`${id}-v`} value={s.verification} onChange={(e) => set('verification', Number(e.target.value) as Verification)}>
              {VERIFICATION_LABELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${id}-c`}>Category</label>
            <select id={`${id}-c`} value={s.category} onChange={(e) => set('category', e.target.value as Category)}>
              {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <label htmlFor={`${id}-a`}>Deal size (USD)</label>
        <input id={`${id}-a`} type="number" min={10} max={100000} step={10} value={s.amountUsd} onChange={(e) => set('amountUsd', num(e.target.value, 10, 100000))} />
        <p className="muted small">
          Simplified for illustration: assumes ~$100 past deals with many different counterparties and no time decay.
          The live product also weighs deal value, recency, and caps how much any one counterparty can vouch for another.
        </p>
      </div>

      <div className="calc-out" aria-live="polite">
        <div className="calc-score">
          <span className={`tier tier-${q.tier}`}>{q.tier}</span>
          <div>
            <div className="big">{q.score}<span className="muted"> / 1000</span></div>
            <div className="muted small">Bond Score</div>
          </div>
        </div>

        {q.declined ? (
          <div className="verdict verdict-bad">
            <strong>Uninsurable</strong>
            <p>
              Estimated fault probability is {pct(q.pd)}, above Bond’s {pct(MAX_PD, 0)} ceiling. No price makes this risk
              worth taking, so the deal is declined and the buyer is pointed to safer options.
            </p>
          </div>
        ) : (
          <div className="verdict">
            <div className="muted small">Premium to insure {usd(s.amountUsd)}</div>
            <div className="big">{usd(q.premiumUsd)} <span className="muted">{pct(q.rate, 2)}</span></div>
          </div>
        )}

        <dl className="breakdown">
          <div><dt>Base fault probability</dt><dd>{pct(q.baseFaultProb)}</dd></div>
          <div><dt>Verification discount</dt><dd>−{pct(q.verificationDiscount, 0)}</dd></div>
          <div><dt>Category load</dt><dd>×{q.categoryLoad}</dd></div>
          <div><dt>Adjusted fault probability</dt><dd>{pct(q.pd)}</dd></div>
          <div><dt>Deal size load × margin</dt><dd>×{q.sizeLoad.toFixed(2)} × {q.loading}</dd></div>
        </dl>
      </div>
    </div>
  );
}
