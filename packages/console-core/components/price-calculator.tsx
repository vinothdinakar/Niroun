'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { CATEGORIES, usd } from '../lib/format';
import type { Agent, Quote } from '../lib/types';

type Answer = Quote | { declined: true; pd: number; seller: { name: string } } | 'error' | null;

// "What would it cost to insure a deal with this seller, right now?" Asks the API's live pricing preview.
export function PriceCalculator({ agents }: { agents: Agent[] }) {
  const [seller, setSeller] = useState('');
  const [amount, setAmount] = useState('500');
  const [category, setCategory] = useState('digital_goods');
  const [answer, setAnswer] = useState<Answer>(null);

  const sellerId = seller || agents[0]?.id || '';

  useEffect(() => {
    const cents = Math.round(Number(amount) * 100);
    if (!sellerId || !(cents > 0)) return;
    let live = true;
    const t = setTimeout(() => {
      api<Answer>('GET', `/v1/pricing/preview?seller=${encodeURIComponent(sellerId)}&amountCents=${cents}&category=${encodeURIComponent(category)}`)
        .then((q) => { if (live) setAnswer(q); })
        .catch(() => { if (live) setAnswer('error'); });
    }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [sellerId, amount, category]);

  return (
    <section className="panel">
      <h2>Price a bond <small>what would it cost to insure a deal with this seller, right now?</small></h2>
      <div className="calc">
        <div>
          <label htmlFor="c-seller">Counterparty (seller)</label>
          <select id="c-seller" value={sellerId} onChange={(e) => setSeller(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.score})</option>)}
          </select>
          <label htmlFor="c-amount">Deal size (USD)</label>
          <input id="c-amount" type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <label htmlFor="c-cat">Category</label>
          <select id="c-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ').replace(/^./, (m) => m.toUpperCase())}</option>)}
          </select>
        </div>
        <div className="quote"><QuoteView answer={answer} /></div>
      </div>
    </section>
  );
}

function QuoteView({ answer }: { answer: Answer }) {
  if (answer === 'error') return <div className="muted">Could not price this deal.</div>;
  if (!answer) return null;
  if (answer.declined && !('factors' in answer)) {
    return (
      <>
        <div className="muted">Bond&apos;s answer</div>
        <div className="big" style={{ color: 'var(--red)' }}>Uninsurable</div>
        <p className="muted">{answer.seller.name} has an estimated fault probability of {(answer.pd * 100).toFixed(1)}%, above Bond&apos;s 35% ceiling.</p>
      </>
    );
  }
  const q = answer as Quote;
  const f = q.factors;
  return (
    <>
      <div className="muted">Premium to insure {usd(q.coverageCents)}</div>
      <div className="big">{usd(q.premiumCents)} <span className="muted" style={{ fontSize: 15 }}>{(q.rate * 100).toFixed(2)}%</span></div>
      <dl>
        <dt>{q.seller.name} Bond Score</dt><dd>{q.seller.score} ({q.seller.tier})</dd>
        <dt>Base fault probability</dt><dd>{(f.baseFaultProb * 100).toFixed(1)}%</dd>
        <dt>Verification discount</dt><dd>−{(f.verificationDiscount * 100).toFixed(0)}%</dd>
        <dt>Category load</dt><dd>×{f.categoryLoad}</dd>
        <dt>Adjusted fault probability</dt><dd>{(q.pd * 100).toFixed(1)}%</dd>
        <dt>Size load × margin</dt><dd>×{f.sizeLoad.toFixed(2)} × {f.loading}</dd>
      </dl>
      {q.capacity.length > 0 && <p style={{ color: 'var(--amber)' }}>{q.capacity[0].message}</p>}
    </>
  );
}
