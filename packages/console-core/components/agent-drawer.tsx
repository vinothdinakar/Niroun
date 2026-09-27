'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, errorMessage } from '../lib/api';
import { CATEGORIES, VERIFY, scoreColor, usd0, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { AgentProfile, LedgerView, Policy } from '../lib/types';
import { StatusPill, Tier } from './ui';

interface DrawerValue {
  open: (agentId: string) => void;
  /** Bumps whenever the drawer changed something (status, mandate, verification): pages re-load their lists. */
  version: number;
}
const DrawerContext = createContext<DrawerValue>({ open: () => undefined, version: 0 });
export const useAgentDrawer = (): DrawerValue => useContext(DrawerContext);

export function AgentDrawerProvider({ children }: { children: ReactNode }) {
  const [agentId, setAgentId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const open = useCallback((id: string) => setAgentId(id), []);
  const value = useMemo(() => ({ open, version }), [open, version]);
  return (
    <DrawerContext.Provider value={value}>
      {children}
      <div className={'backdrop' + (agentId ? ' open' : '')} onClick={() => setAgentId(null)} />
      <aside className={'drawer' + (agentId ? ' open' : '')} aria-hidden={!agentId} aria-label="Agent details">
        {agentId && <DrawerBody id={agentId} onClose={() => setAgentId(null)} onChanged={() => setVersion((v) => v + 1)} />}
      </aside>
    </DrawerContext.Provider>
  );
}

interface Loaded { p: AgentProfile; l: LedgerView | null; policy: Policy | null }

function DrawerBody({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { me, has, isStaff } = useSession();
  const toast = useToast();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState('');
  const closeBtn = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const [p, l, detail] = await Promise.all([
        api<AgentProfile>('GET', `/v1/agents/${id}`),
        api<LedgerView>('GET', `/v1/agents/${id}/ledger`).catch(() => null), // 404 unless it's yours (or you're staff)
        api<{ policy: Policy }>('GET', `/v1/console/agents/${id}`).catch(() => null),
      ]);
      setData({ p, l, policy: detail?.policy ?? null });
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => { closeBtn.current?.focus(); }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const changed = async () => { onChanged(); await load(); };
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

  const p = data?.p;
  const l = data?.l;
  const canStatus = !!p && has('agents_suspend') && mine(p);
  const canPolicy = !!p && has('agents_manage') && mine(p);

  return (
    <>
      <button ref={closeBtn} className="btn ghost sm close" onClick={onClose}>Close</button>
      {error && <p style={{ color: 'var(--red)' }}>{error}</p>}
      {!p && !error && <p className="muted">Loading…</p>}
      {p && (
        <>
          <h3>{p.name} <Tier tier={p.tier} /></h3>
          <div className="muted">
            {p.owner} · {VERIFY[p.verification]}{p.status === 'suspended' && <> · <span className="pill red">Suspended</span></>}
          </div>
          <div className="id">{p.id}</div>
          <div style={{ fontSize: 38, fontWeight: 700, margin: '14px 0 2px', color: scoreColor(p.score) }}>
            {p.score}<span className="muted" style={{ fontSize: 14, fontWeight: 400 }}> / 1000 Bond Score</span>
          </div>
          <Sparkline history={p.history} />
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

          {data.policy && <MandateForm key={JSON.stringify(data.policy)} agentId={p.id} policy={data.policy} canEdit={canPolicy} onSaved={changed} />}

          {l ? (
            <>
              <p className={l.verification.ok ? 'ver' : ''} style={l.verification.ok ? undefined : { color: 'var(--red)' }}>
                {l.verification.ok
                  ? <>✓ Audit ledger intact: {l.verification.length} entries, head <code>{(l.verification.headHash || '').slice(0, 16)}…</code></>
                  : <>✗ Ledger tampering detected at entry {l.verification.brokenAt}</>}
              </p>
              <h4 style={{ margin: '18px 0 6px' }} className="muted">Recent ledger entries</h4>
              {l.entries.slice(0, 40).map((e, i) => (
                <div className="entry" key={i}><span className="t">{when(e.ts)}</span><span className="k">{e.type}</span><span className="d">{JSON.stringify(e.data)}</span></div>
              ))}
            </>
          ) : (
            <p className="muted">The detailed audit trail is visible to the agent&apos;s owner and to Bond staff.</p>
          )}
        </>
      )}
    </>
  );
}

function Sparkline({ history }: { history: { score: number }[] }) {
  const w = 460, h = 80, lo = 300, hi = 1000;
  if (history.length < 2) return null;
  const x = (i: number) => (i / (history.length - 1)) * w;
  const y = (s: number) => h - ((Math.max(lo, Math.min(hi, s)) - lo) / (hi - lo)) * (h - 8) - 4;
  const pts = history.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const last = history[history.length - 1];
  const color = scoreColor(last.score);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Bond score over time">
      <polygon points={`0,${h} ${pts} ${w},${h}`} fill={color} opacity=".12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
      <circle cx={x(history.length - 1)} cy={y(last.score)} r="4" fill={color} />
    </svg>
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
