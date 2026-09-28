'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, qs } from '../lib/api';
import { CATEGORIES, VERIFY, scoreColor, usd0, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { AgentProfile, LedgerView, Policy } from '../lib/types';
import { ScoreHistoryChart, SpendVsMandateChart } from './charts';
import { Pager } from './list-controls';
import { ExpandableCell, StatusPill, Tier } from './ui';

const LEDGER_PAGE_SIZE = 50;

interface Loaded { p: AgentProfile; policy: Policy | null }

export function AgentDetailView({ id }: { id: string }) {
  const { me, has, isStaff } = useSession();
  const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const [ledger, setLedger] = useState<LedgerView | null | undefined>(undefined); // undefined = still loading, null = not visible to you
  const [ledgerPage, setLedgerPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const [p, detail] = await Promise.all([
        api<AgentProfile>('GET', `/v1/agents/${id}`),
        api<{ policy: Policy }>('GET', `/v1/console/agents/${id}`).catch(() => null),
      ]);
      setData({ p, policy: detail?.policy ?? null });
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  const loadLedger = useCallback(async () => {
    setLedger(undefined);
    // 404 unless it's yours (or you're staff) — the panel below just shows an explainer instead
    setLedger(await api<LedgerView>('GET', `/v1/agents/${id}/ledger${qs({ page: ledgerPage, pageSize: LEDGER_PAGE_SIZE })}`).catch(() => null));
  }, [id, ledgerPage]);

  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => { loadLedger(); }, [loadLedger]);

  const changed = async () => { await load(); await loadLedger(); };
  const mine = (p: AgentProfile) => isStaff || p.orgId === me?.user.orgId;

  async function setStatus(p: AgentProfile, status: 'active' | 'suspended') {
    try {
      await api('POST', `/v1/console/agents/${p.id}/status`, { status });
      toast(status === 'suspended' ? 'Agent suspended' : 'Agent resumed');
      await changed();
    } catch (err) { toast(errorMessage(err), true); }
  }

  async function setVerification(p: AgentProfile, level: number) {
    try {
      await api('POST', `/v1/console/agents/${p.id}/verify`, { level });
      toast('Verification updated');
      await changed();
    } catch (err) { toast(errorMessage(err), true); }
  }

  if (error) return <p className="form-error">{error}</p>;

  const p = data?.p;
  const l = ledger;
  const canStatus = !!p && has('agents_suspend') && mine(p);
  const canPolicy = !!p && has('agents_manage') && mine(p);

  return (
    <div className="tab">
      <p><Link href="/agents">← All agents</Link></p>
      {!p && !error && <p className="muted">Loading…</p>}
      {p && (
        <>
          <section className="panel pad">
            <h2 className="plain">{p.name} <Tier tier={p.tier} /></h2>
            <div className="muted">
              {p.owner} · {VERIFY[p.verification]}{p.status === 'suspended' && <> · <span className="pill red">Suspended</span></>}
            </div>
            <p className="muted small id">{p.id}</p>
            <div style={{ fontSize: 38, fontWeight: 700, margin: '14px 0 2px', color: scoreColor(p.score) }}>
              {p.score}<span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> / 1000 Bond Score</span>
            </div>
            <ScoreHistoryChart history={p.history} />
            <div className="grid4">
              <div><b>{p.stats.fulfilled}</b><span>Fulfilled</span></div>
              <div><b>{p.stats.faults}</b><span>Faults</span></div>
              <div><b>{(p.faultRate * 100).toFixed(1)}%</b><span>Fault rate</span></div>
              <div><b>{usd0(p.stats.volumeCents)}</b><span>Volume</span></div>
            </div>

            {(canStatus || has('verify')) && (
              <div className="manage">
                <h4>Controls</h4>
                <p>
                  Status: <StatusPill suspended={p.status === 'suspended'} />{' '}
                  {canStatus && (
                    <button className={`btn ${p.status === 'suspended' ? 'primary' : 'danger'} sm`} onClick={() => setStatus(p, p.status === 'suspended' ? 'active' : 'suspended')}>
                      {p.status === 'suspended' ? 'Resume agent' : 'Suspend agent'}
                    </button>
                  )}
                </p>
                {has('verify') && (
                  <>
                    <label htmlFor="dv-level">Owner verification</label>
                    <select id="dv-level" value={p.verification} onChange={(e) => setVerification(p, Number(e.target.value))}>
                      {VERIFY.map((v, i) => <option key={v} value={i}>{v}</option>)}
                    </select>
                  </>
                )}
              </div>
            )}

            {data?.policy && <MandateForm key={JSON.stringify(data.policy)} agentId={p.id} policy={data.policy} canEdit={canPolicy} onSaved={changed} />}
            {data?.policy && <SpendVsMandateChart spend={p.spend} dailyLimitCents={data.policy.dailyLimitCents} />}
          </section>

          <section className="panel pad">
            {l === undefined ? (
              <p className="muted">Loading…</p>
            ) : l ? (
              <>
                <p className={l.verification.ok ? 'ver' : ''} style={l.verification.ok ? undefined : { color: 'var(--red)' }}>
                  {l.verification.ok
                    ? <>✓ Audit ledger intact: {l.verification.length} entries, head <code>{(l.verification.headHash || '').slice(0, 16)}…</code></>
                    : <>✗ Ledger tampering detected at entry {l.verification.brokenAt}</>}
                </p>
                <h4 className="muted">Ledger ({l.total.toLocaleString()} entries)</h4>
                {l.entries.map((e, i) => (
                  <div className="entry" key={i}><span className="t">{when(e.ts)}</span><span className="k">{e.type}</span><ExpandableCell text={JSON.stringify(e.data)} /></div>
                ))}
                <Pager page={ledgerPage} pageSize={LEDGER_PAGE_SIZE} total={l.total} onPage={setLedgerPage} />
              </>
            ) : (
              <p className="muted">The detailed audit trail is visible to the agent&apos;s owner and to Bond staff.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// The agent's spending mandate. Owners (and staff) edit it; each change is recorded in the agent's audit ledger.
function MandateForm({ agentId, policy, canEdit, onSaved }: { agentId: string; policy: Policy; canEdit: boolean; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const [perTx, setPerTx] = useState(String(policy.perTxLimitCents / 100));
  const [perDay, setPerDay] = useState(String(policy.dailyLimitCents / 100));
  const [minScore, setMinScore] = useState(String(policy.minCounterpartyScore));
  const [cats, setCats] = useState<Set<string>>(new Set(policy.allowedCategories ?? []));
  const [error, setError] = useState('');

  const toggle = (c: string) => setCats((s) => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('PUT', `/v1/console/agents/${agentId}/policy`, {
        perTxLimitCents: Math.round(Number(perTx) * 100),
        dailyLimitCents: Math.round(Number(perDay) * 100),
        minCounterpartyScore: Number(minScore),
        allowedCategories: cats.size ? [...cats] : null,
      });
      toast('Mandate saved');
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="manage">
      <h4>Spending mandate{canEdit ? '' : ' (read-only)'}</h4>
      <form onSubmit={submit}>
        <div className="row">
          <div><label htmlFor="pl-tx">Per deal (USD)</label><input id="pl-tx" type="number" min="1" step="1" value={perTx} onChange={(e) => setPerTx(e.target.value)} disabled={!canEdit} /></div>
          <div><label htmlFor="pl-day">Per 24h (USD)</label><input id="pl-day" type="number" min="1" step="1" value={perDay} onChange={(e) => setPerDay(e.target.value)} disabled={!canEdit} /></div>
          <div><label htmlFor="pl-min">Min counterparty score</label><input id="pl-min" type="number" min="0" max="1000" step="1" value={minScore} onChange={(e) => setMinScore(e.target.value)} disabled={!canEdit} /></div>
        </div>
        <label>Allowed categories <span className="muted">(none ticked = any)</span></label>
        <div className="checks">
          {CATEGORIES.map((c) => (
            <label key={c}><input type="checkbox" checked={cats.has(c)} onChange={() => toggle(c)} disabled={!canEdit} /> {c.replace('_', ' ')}</label>
          ))}
        </div>
        {canEdit && (
          <>
            <p className="form-error" role="alert">{error}</p>
            <button className="btn primary sm" type="submit">Save mandate</button> <span className="muted small">Recorded in the agent&apos;s audit ledger.</span>
          </>
        )}
      </form>
    </div>
  );
}
