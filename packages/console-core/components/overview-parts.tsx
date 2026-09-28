'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { CATEGORIES, VERDICT, VERIFY, usd, usd0, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Agent, Dispute, Org, OwnerOverview, PoolStats, Tx } from '../lib/types';
import { EmptyRow, Pill, ScoreBar, Tier } from './ui';

// ---------- headline numbers ----------
const Kpi = ({ label, value, sub }: { label: string; value: string | number; sub: string }) => (
  <div className="kpi"><div className="label">{label}</div><div className="value">{value}</div><div className="sub">{sub}</div></div>
);

export function Kpis({ head }: { head: PoolStats | OwnerOverview }) {
  const { isStaff } = useSession();
  if (isStaff && 'pool' in head) {
    const p = head.pool;
    return (
      <div className="kpis">
        <Kpi label="Reserve pool" value={usd0(p.balanceCents)} sub={`capital ${usd0(p.capitalCents)} + earned premiums`} />
        <Kpi label="Coverage in force" value={usd0(p.reservedCoverageCents)} sub={`capacity ${usd0(p.maxCoverageCents)}`} />
        <Kpi label="Premiums earned" value={usd0(p.premiumsCents - p.refundsCents)} sub={`${head.counts.transactions} bonded deals · ${usd0(head.volumeCents)} volume`} />
        <Kpi label="Claims paid" value={usd0(p.payoutsCents)} sub={`${head.counts.disputes} disputes opened`} />
        <Kpi label="Loss ratio" value={(head.lossRatio * 100).toFixed(0) + '%'} sub="claims ÷ premiums (healthy: 50–70%)" />
        <Kpi label="Solvency" value={head.solvencyRatio ? head.solvencyRatio.toFixed(1) + '×' : '—'} sub={head.solvencyRatio ? 'pool ÷ required reserve' : 'no open exposure'} />
      </div>
    );
  }
  if ('agents' in head) {
    return (
      <div className="kpis">
        <Kpi label="Your agents" value={head.agents} sub={head.suspended ? `${head.suspended} suspended` : 'all active'} />
        <Kpi label="Deals" value={head.transactions} sub={`${usd0(head.volumeCents)} volume`} />
        <Kpi label="Blocked by your limits" value={head.blockedAttempts} sub="attempts your mandate stopped" />
        <Kpi label="Refunds received" value={usd0(head.payoutsReceivedCents)} sub="from failed deals" />
        <Kpi label="Disputes awaiting review" value={head.openDisputes} sub="with Bond reviewers" />
      </div>
    );
  }
  return null;
}

// ---------- getting started (customers, until an agent is connected and the company verified) ----------
export function Onboarding({ overview, org }: { overview: OwnerOverview; org: Org | undefined }) {
  const { has, isStaff } = useSession();
  if (isStaff || !org || (overview.agents > 0 && org.verification)) return null;
  return (
    <div className="onboard">
      <h3>Welcome, {org.name}</h3>
      <div className="muted">A few steps to get your agents trading safely.</div>
      <ol>
        <li className="done">Company account created and email verified</li>
        <li className={overview.agents > 0 ? 'done' : ''}>
          Connect your first agent
          {overview.agents === 0 && has('enroll') && <> <Link className="btn primary sm" href="/connect">Generate an enrollment code</Link></>}
        </li>
        <li className={org.verification ? 'done' : ''}>
          {org.verification ? 'Your organization is verified' : 'Get your organization verified. Bond staff verify businesses (this is not automatic yet). Verified organizations get lower bond premiums on their agents.'}
        </li>
        <li>Invite your team{has('team_manage') && <> <Link className="btn ghost sm" href="/team">Open Team</Link></>}</li>
      </ol>
    </div>
  );
}

// ---------- agent registry ----------
export function AgentsTable({ agents }: { agents: Agent[] }) {
  const { me } = useSession();
  const router = useRouter();
  const mineOrg = me?.user.orgId;
  return (
    <table>
      <thead><tr><th>Agent</th><th>Tier</th><th>Bond Score</th><th className="num">Fault rate</th><th>Status</th></tr></thead>
      <tbody>
        {agents.map((a) => (
          <tr key={a.id} className="click" onClick={() => router.push(`/agents/${a.id}`)}>
            <td>
              <div className="name"><Link className="rowbtn" href={`/agents/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.name}</Link>{mineOrg && a.orgId === mineOrg && <span className="mine">YOURS</span>}</div>
              <div className="owner">{a.owner}</div>
            </td>
            <td><Tier tier={a.tier} /></td>
            <td>{a.score}<ScoreBar score={a.score} /></td>
            <td className="num">{(a.faultRate * 100).toFixed(1)}%</td>
            <td className="muted">{a.status === 'suspended' && <><span className="pill red">Suspended</span>{' '}</>}{a.verification > 0 && <><span className="ver">✓</span>{' '}</>}{VERIFY[a.verification]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- transactions ----------
export function TxsTable({ txs, showCategory }: { txs: Tx[]; showCategory?: boolean }) {
  return (
    <table>
      <thead>
        <tr>
          <th>Updated</th><th>Buyer → Seller</th>{showCategory && <th>Category</th>}
          <th className="num">Amount</th><th className="num">Premium</th><th>Status</th>
        </tr>
      </thead>
      <tbody>
        {txs.length ? txs.map((t) => (
          <tr key={t.id}>
            <td className="muted"><Link href={`/deals/${t.id}`}>{when(t.updatedAt)}</Link></td>
            <td>{t.buyerName}<span className="arrow">→</span>{t.sellerName}</td>
            {showCategory && <td className="muted">{t.category && CATEGORIES.includes(t.category) ? t.category.replace('_', ' ') : t.category}</td>}
            <td className="num">{usd(t.amountCents)}</td>
            <td className="num">{t.premiumCents ? usd(t.premiumCents) : '—'}</td>
            <td><Pill status={t.status} />{t.payoutCents ? <> <span className="muted">{usd0(t.payoutCents)}</span></> : null}</td>
          </tr>
        )) : <EmptyRow cols={showCategory ? 6 : 5}>No transactions yet.</EmptyRow>}
      </tbody>
    </table>
  );
}

// ---------- disputes ----------
export function DisputesTable({ disputes, onResolved }: { disputes: Dispute[]; onResolved: () => void }) {
  const { has } = useSession();
  const canResolve = has('resolve');
  return (
    <table>
      <thead>
        <tr>
          <th>Opened</th><th>Buyer → Seller</th><th className="num">Amount</th><th>Verdict</th><th>Rule</th><th>Why</th>
          {canResolve && <th>Decision</th>}
        </tr>
      </thead>
      <tbody>
        {disputes.length ? disputes.map((d) => {
          const [label, color] = VERDICT[d.status === 'needs_review' ? 'needs_review' : d.verdict] ?? ['—', 'gray'];
          return (
            <tr key={d.id}>
              <td className="muted">{when(d.openedAt)}</td>
              <td>{d.buyerName}<span className="arrow">→</span>{d.sellerName}</td>
              <td className="num">{usd(d.amountCents)}</td>
              <td><span className={`pill ${color}`}>{label}</span>{d.payoutCents ? <> <span className="muted">{usd(d.payoutCents)}</span></> : null}</td>
              <td className="muted" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{d.rule}</td>
              <td className="reasons">{(d.reasons ?? []).join(' ')}</td>
              {canResolve && (
                <td>
                  {d.status === 'needs_review'
                    ? <ReviewCell id={d.id} onResolved={onResolved} />
                    : <span className="muted small">{d.decidedBy === 'human' ? d.reviewedBy || 'human' : 'automatic'}</span>}
                </td>
              )}
            </tr>
          );
        }) : <EmptyRow cols={canResolve ? 7 : 6}>No disputes.</EmptyRow>}
      </tbody>
    </table>
  );
}

// A reviewer's decision on a dispute the arbiter couldn't settle. Its inputs are local state, so the 3-second
// refresh of the list can never wipe a note that's half typed.
function ReviewCell({ id, onResolved }: { id: string; onResolved: () => void }) {
  const toast = useToast();
  const [verdict, setVerdict] = useState('seller_fault');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    try {
      await api('POST', `/v1/console/disputes/${id}/resolve`, { verdict, note });
      toast('Dispute resolved');
      onResolved();
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review">
      <select aria-label="Verdict" value={verdict} onChange={(e) => setVerdict(e.target.value)}>
        <option value="seller_fault">Seller at fault</option>
        <option value="buyer_fault">Buyer at fault</option>
        <option value="not_covered">Not covered</option>
      </select>
      <input aria-label="Note" placeholder="Note (why)" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn primary sm" onClick={resolve} disabled={busy}>Resolve</button>
    </div>
  );
}
