'use client';

import { useState } from 'react';
import { api, qs } from '../lib/api';
import { VERIFY } from '../lib/format';
import type { Agent } from '../lib/types';
import { ExportLink, MultiSelect, Pager, SearchBar } from './list-controls';
import { AgentsTable } from './overview-parts';
import { Panel } from './ui';
import { useLoaderShim } from './use-loader-shim';

const PAGE_SIZE = 25;
const TIERS = ['A', 'B', 'C', 'D', 'E', 'NR'];

export function AgentsDirectoryView() {
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
      <Panel title="Agents" hint={data ? <ExportLink href={`/v1/agents/export${qs(opts)}`} /> : null}>
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
        {!data ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : <AgentsTable agents={data.agents} />}
        {data && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
      </Panel>
    </div>
  );
}
