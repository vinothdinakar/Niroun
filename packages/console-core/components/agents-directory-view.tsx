'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, qs } from '../lib/api';
import { VERIFY, orgVerifyLabel } from '../lib/format';
import { useSession } from '../lib/session';
import type { Agent } from '../lib/types';
import { ExportLink, MultiSelect, Pager, SearchBar } from './list-controls';
import { Panel, ScoreBar, Tier } from './ui';
import { useLoaderShim } from './use-loader-shim';

const PAGE_SIZE = 25;
const TIERS = ['A', 'B', 'C', 'D', 'E', 'NR'];

export function AgentsDirectoryView() {
  const { me } = useSession();
  const mineOrg = me?.user.orgId;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'' | 'active' | 'suspended'>('');
  const [tier, setTier] = useState<Set<string>>(new Set());
  const [verification, setVerification] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const opts = { search, status: status || undefined, tier: [...tier], verification: [...verification] };
  const { data, error } = useLoaderShim(
    () => api<{ agents: Agent[]; total: number }>('GET', `/v1/agents${qs({ ...opts, page, pageSize: PAGE_SIZE })}`),
    [search, status, [...tier].join(','), [...verification].join(','), page],
  );

  if (error) return <p className="form-error">{error}</p>;

  const tierOptions = TIERS.map((t) => ({ value: t, label: t }));
  const verificationOptions = VERIFY.map((label, i) => ({ value: String(i), label }));

  return (
    <div className="tab">
      <Panel title="Agent Marketplace" hint={data ? <ExportLink href={`/v1/agents/export${qs(opts)}`} /> : null}>
        <div className="filter-bar">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by name, owner or id…" />
          <select value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
          <MultiSelect label="Tier" options={tierOptions} selected={tier} onChange={(n) => { setTier(n); setPage(1); }} />
          <MultiSelect label="Verification" options={verificationOptions} selected={verification} onChange={(n) => { setVerification(n); setPage(1); }} />
        </div>
        {!data ? (
          <p className="muted" style={{ padding: 16 }}>Loading…</p>
        ) : data.agents.length ? (
          <div className="agent-grid">
            {data.agents.map((a) => (
              <Link key={a.id} href={`/agents/${a.id}`} className="agent-card">
                <div className="agent-card-top">
                  <Tier tier={a.tier} />
                  {a.status === 'suspended' && <span className="pill red">Suspended</span>}
                </div>
                <h3>{a.name}{mineOrg && a.orgId === mineOrg && <span className="mine">YOURS</span>}</h3>
                <p className="owner">{a.owner}</p>
                <div className="agent-card-score">
                  {a.score}<ScoreBar score={a.score} />
                </div>
                <div className="agent-card-meta">
                  <span>{(a.faultRate * 100).toFixed(1)}% fault rate</span>
                  <span>{a.verification > 0 && '✓ '}{orgVerifyLabel(a.verification, a.accountType)}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted" style={{ padding: 16 }}>No agents match your filters.</p>
        )}
        {data && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
      </Panel>
    </div>
  );
}
