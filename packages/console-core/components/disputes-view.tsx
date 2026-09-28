'use client';

import { useState } from 'react';
import { api, qs } from '../lib/api';
import { VERDICT } from '../lib/format';
import type { Dispute } from '../lib/types';
import { ExportLink, MultiSelect, Pager, SearchBar } from './list-controls';
import { DisputesTable } from './overview-parts';
import { Panel } from './ui';
import { useLoaderShim } from './use-loader-shim';

const PAGE_SIZE = 25;
const STATUSES = ['open', 'needs_review', 'resolved'];
const VERDICTS = Object.keys(VERDICT);

export function DisputesView() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Set<string>>(new Set());
  const [verdict, setVerdict] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const opts = { search, status: [...status], verdict: [...verdict], from: from ? Date.parse(from) : undefined, to: to ? Date.parse(to) : undefined };
  const { data, error, reload } = useLoaderShim(
    () => api<{ disputes: Dispute[]; total: number }>('GET', `/v1/disputes${qs({ ...opts, page, pageSize: PAGE_SIZE })}`),
    [search, [...status].join(','), [...verdict].join(','), from, to, page],
  );

  if (error) return <p className="form-error">{error}</p>;

  const statusOptions = STATUSES.map((s) => ({ value: s, label: s.replace('_', ' ') }));
  const verdictOptions = VERDICTS.map((v) => ({ value: v, label: VERDICT[v][0] }));

  return (
    <div className="tab">
      <Panel title="Disputes" hint={data ? <ExportLink href={`/v1/disputes/export${qs(opts)}`} /> : null}>
        <div className="filter-bar">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by agent name or dispute/deal id…" />
          <MultiSelect label="Status" options={statusOptions} selected={status} onChange={(n) => { setStatus(n); setPage(1); }} />
          <MultiSelect label="Verdict" options={verdictOptions} selected={verdict} onChange={(n) => { setVerdict(n); setPage(1); }} />
          <label className="muted small">From <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
          <label className="muted small">To <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        </div>
        {!data ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : <DisputesTable disputes={data.disputes} onResolved={reload} />}
        {data && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
      </Panel>
    </div>
  );
}
