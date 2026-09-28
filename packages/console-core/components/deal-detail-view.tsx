'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { CATEGORIES, VERDICT, usd, usd0, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { DealDetail } from '../lib/types';
import { useLoaderShim } from './use-loader-shim';
import { Pill } from './ui';

const DISPUTABLE = new Set(['funded', 'delivered']);

export function DealDetailView({ id }: { id: string }) {
  const { data, error, reload } = useLoaderShim(() => api<DealDetail>('GET', `/v1/transactions/${id}`), [id]);
  const { me, has, isStaff } = useSession();

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const canDispute = !data.disputeId && DISPUTABLE.has(data.status) && (isStaff || (has('agents_manage') && data.buyerOrgId === me?.user.orgId));

  return (
    <div className="tab">
      <p><Link href="/deals">← All deals</Link></p>
      <section className="panel pad">
        <h2 className="plain">
          {data.buyerName} <span className="arrow">→</span> {data.sellerName}{' '}
          <Pill status={data.status} />
        </h2>
        <p className="muted small id">{data.id}</p>
        <div className="deal-summary">
          <div><b>{usd(data.amountCents)}</b><span>Amount</span></div>
          <div><b>{data.coverageCents ? usd(data.coverageCents) : '—'}</b><span>Coverage</span></div>
          <div><b>{data.premiumCents ? usd(data.premiumCents) : '—'}</b><span>Premium</span></div>
          <div><b>{data.payoutCents ? usd(data.payoutCents) : '—'}</b><span>Payout</span></div>
          <div><b>{CATEGORIES.includes(data.category) ? data.category.replace('_', ' ') : data.category}</b><span>Category</span></div>
          <div><b>{when(data.deliverBy)}</b><span>Deliver by</span></div>
        </div>
        <p className="muted small">{data.terms.spec}</p>
        {canDispute && <OpenDisputeForm id={data.id} onOpened={reload} />}
      </section>

      <section className="panel pad">
        <h4 className="muted">Timeline ({data.events.length} events)</h4>
        {data.events.map((e, i) => (
          <div className="entry" key={i}>
            <span className="t">{when(e.ts)}</span>
            <span className="who">{e.agentId === data.buyerId ? 'Buyer' : e.agentId === data.sellerId ? 'Seller' : '—'}</span>
            <span className="k">{e.type}</span>
            <span className="d">{JSON.stringify(e.data)}</span>
          </div>
        ))}
      </section>

      {data.dispute && <DisputeDetail d={data.dispute} />}
    </div>
  );
}

function DisputeDetail({ d }: { d: NonNullable<DealDetail['dispute']> }) {
  const [label, color] = VERDICT[d.status === 'needs_review' ? 'needs_review' : (d.verdict ?? '')] ?? ['Open — awaiting the arbiter', 'blue'];
  return (
    <section className="panel pad">
      <h2 className="plain">
        Dispute <span className={`pill ${color}`}>{label}</span>
      </h2>
      <p className="muted small id">{d.id}</p>
      <div className="deal-summary">
        <div><b>{when(d.openedAt)}</b><span>Opened</span></div>
        <div><b>{d.resolvedAt ? when(d.resolvedAt) : '—'}</b><span>Resolved</span></div>
        <div><b>{d.decidedBy ? (d.decidedBy === 'auto' ? "Bond's arbiter" : 'A human reviewer') : '—'}</b><span>Decided by</span></div>
        <div><b>{d.reviewedBy || '—'}</b><span>Reviewer</span></div>
        <div><b>{d.rule || '—'}</b><span>Rule</span></div>
      </div>
      {d.reason && <p className="muted small">"{d.reason}"</p>}
      {d.reasons.length > 0 && (
        <ul className="muted small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {d.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </section>
  );
}

/**
 * Self-service: opens a dispute without the buyer agent's own signature (see `ConsoleController.openDispute`).
 * Shown only to the buyer's own org (or staff) on a deal that's still eligible and has no dispute yet — the
 * server enforces the same rules regardless, this just avoids showing the form where it would only 409.
 */
function OpenDisputeForm({ id, onOpened }: { id: string; onOpened: () => Promise<void> }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <p className="small">
        <button className="btn ghost sm" onClick={() => setOpen(true)}>Open a dispute</button>{' '}
        <span className="muted">on behalf of the buyer — for when the agent's own integration hasn't raised one itself</span>
      </p>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<{ dispute: { verdict: string | null; status: string } }>('POST', `/v1/console/transactions/${id}/disputes`, { reason });
      toast(r.dispute.verdict ? `Dispute resolved: ${r.dispute.verdict.replace('_', ' ')}` : 'Dispute opened — awaiting human review');
      setOpen(false);
      setReason('');
      await onOpened();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="manage" onSubmit={submit}>
      <h4>Open a dispute</h4>
      <p className="muted small">Bond's arbiter re-reads both parties' signed ledger for this deal and decides — this only starts that review, it can't force the outcome.</p>
      <label htmlFor="dp-reason">Reason</label>
      <input id="dp-reason" maxLength={1000} placeholder="e.g. nothing arrived" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      <p className="form-error" role="alert">{error}</p>
      <div className="row-end">
        <button className="btn ghost" type="button" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy}>Open dispute</button>
      </div>
    </form>
  );
}
