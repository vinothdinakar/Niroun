'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import type { Agent, Dispute, Org, OwnerOverview, PoolStats, Tx } from '../lib/types';
import { useAgentDrawer } from './agent-drawer';
import { useSetLive } from './app-shell';
import { AgentsTable, DisputesTable, Kpis, Onboarding, TxsTable } from './overview-parts';
import { PriceCalculator } from './price-calculator';
import { Panel } from './ui';

interface Snapshot { head: PoolStats | OwnerOverview; agents: Agent[]; txs: Tx[]; disputes: Dispute[]; org: Org | undefined }

const REFRESH_MS = 3000;

// The overview refreshes itself every few seconds while the tab is visible. Same page for both consoles:
// it already branches on isStaff for the KPIs, the stats endpoint, and the onboarding checklist.
export function OverviewView() {
  const { isStaff, has } = useSession();
  const setLive = useSetLive();
  const { version } = useAgentDrawer();
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [head, ag, tx, dp, orgs] = await Promise.all([
        isStaff ? api<PoolStats>('GET', '/v1/stats') : api<OwnerOverview>('GET', '/v1/console/overview'),
        api<{ agents: Agent[] }>('GET', '/v1/agents'),
        api<{ transactions: Tx[] }>('GET', '/v1/transactions?limit=60'),
        api<{ disputes: Dispute[] }>('GET', '/v1/disputes'),
        isStaff ? null : api<{ orgs: Org[] }>('GET', '/v1/console/orgs'),
      ]);
      setSnap({ head, agents: ag.agents, txs: tx.transactions, disputes: dp.disputes, org: orgs?.orgs[0] });
      setLive(true);
    } catch {
      setLive(false);
    }
  }, [isStaff, setLive]);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    return () => { clearInterval(timer); setLive(false); };
  }, [refresh, version]); // `version` changes when the agent drawer edited something

  if (!snap) return <p className="muted">Loading…</p>;

  return (
    <div className="tab">
      {!isStaff && 'agents' in snap.head && <Onboarding overview={snap.head} org={snap.org} />}
      <Kpis head={snap.head} />
      <div className="cols">
        <Panel title="Agent registry" hint="click an agent for details"><AgentsTable agents={snap.agents} /></Panel>
        <Panel title="Transactions" hint={`latest ${snap.txs.length}`}><TxsTable txs={snap.txs} /></Panel>
      </div>
      <Panel
        title="Disputes" scrollMax={380}
        hint={has('resolve') ? 'items marked "needs human review" are waiting for you' : 'the automated arbiter reads both parties’ signed ledgers'}
      >
        <DisputesTable disputes={snap.disputes} onResolved={refresh} />
      </Panel>
      <PriceCalculator agents={snap.agents} />
    </div>
  );
}
