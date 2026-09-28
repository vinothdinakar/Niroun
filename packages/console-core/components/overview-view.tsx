'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import type { Agent, Dispute, Org, OwnerOverview, PoolStats, TrendPoint, Tx } from '../lib/types';
import { useSetLive } from './app-shell';
import { PremiumPayoutChart } from './charts';
import { AgentsTable, DisputesTable, Kpis, Onboarding, TxsTable } from './overview-parts';
import { PriceCalculator } from './price-calculator';
import { Panel } from './ui';

interface Snapshot { head: PoolStats | OwnerOverview; agents: Agent[]; txs: Tx[]; disputes: Dispute[]; org: Org | undefined; trend: TrendPoint[] }

const REFRESH_MS = 3000;

// The overview refreshes itself every few seconds while the tab is visible. Same page for both consoles:
// it already branches on isStaff for the KPIs, the stats endpoint, and the onboarding checklist.
export function OverviewView() {
  const { isStaff, has } = useSession();
  const setLive = useSetLive();
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [head, ag, tx, dp, orgs, trend] = await Promise.all([
        isStaff ? api<PoolStats>('GET', '/v1/stats') : api<OwnerOverview>('GET', '/v1/console/overview'),
        api<{ agents: Agent[] }>('GET', '/v1/agents'),
        api<{ transactions: Tx[] }>('GET', '/v1/transactions?limit=60'),
        api<{ disputes: Dispute[] }>('GET', '/v1/disputes?pageSize=60'),
        isStaff ? null : api<{ orgs: Org[] }>('GET', '/v1/console/orgs'),
        api<TrendPoint[]>('GET', '/v1/trends'),
      ]);
      setSnap({ head, agents: ag.agents, txs: tx.transactions, disputes: dp.disputes, org: orgs?.orgs[0], trend });
      setLive(true);
    } catch {
      setLive(false);
    }
  }, [isStaff, setLive]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    return () => { clearInterval(timer); setLive(false); };
  }, [refresh]);

  if (!snap) return <p className="muted">Loading…</p>;

  return (
    <div className="tab">
      {!isStaff && 'agents' in snap.head && <Onboarding overview={snap.head} org={snap.org} />}
      <Kpis head={snap.head} />
      <div className="cols">
        <Panel title="Agent registry" hint={<>click an agent for details · <Link href="/agents">See all →</Link></>}><AgentsTable agents={snap.agents} /></Panel>
        <Panel title="Transactions" hint={<>latest {snap.txs.length} · <Link href="/deals">See all →</Link></>}><TxsTable txs={snap.txs} /></Panel>
      </div>
      <section className="panel pad">
        <PremiumPayoutChart points={snap.trend} />
      </section>
      <Panel
        title="Disputes" scrollMax={380}
        hint={<>{has('resolve') ? 'items marked "needs human review" are waiting for you' : 'the automated arbiter reads both parties’ signed ledgers'} · <Link href="/disputes">See all →</Link></>}
      >
        <DisputesTable disputes={snap.disputes} onResolved={refresh} />
      </Panel>
      <PriceCalculator agents={snap.agents} />
    </div>
  );
}
