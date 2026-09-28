'use client';

import { useState } from 'react';
import { api, qs } from '../lib/api';
import { CATEGORIES, STATUS } from '../lib/format';
import type { Tx } from '../lib/types';
import { ExportLink, MultiSelect, Pager, SearchBar } from './list-controls';
import { TxsTable } from './overview-parts';
import { Panel } from './ui';
import { useLoaderShim } from './use-loader-shim';

const PAGE_SIZE = 25;

export function DealsView() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const query = { search, status: [...status], category: [...category], from: from ? Date.parse(from) : undefined, to: to ? Date.parse(to) : undefined, page, pageSize: PAGE_SIZE };
  const { data, error } = useLoaderShim(
    () => api<{ transactions: Tx[]; total: number }>('GET', `/v1/transactions${qs(query)}`),
    [search, [...status].join(','), [...category].join(','), from, to, page],
  );

  if (error) return <p className="form-error">{error}</p>;

  const statusOptions = Object.entries(STATUS).map(([value, [label]]) => ({ value, label }));
  const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: c.replace('_', ' ') }));

  return (
    <div className="tab">
      <Panel title="Deals" hint={data ? <ExportLink href={`/v1/transactions/export${qs({ search, status: [...status], category: [...category], from: query.from, to: query.to })}`} /> : null}>
        <div className="filter-bar">
          <SearchBar value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by agent name or deal id…" />
          <MultiSelect label="Status" options={statusOptions} selected={status} onChange={(n) => { setStatus(n); setPage(1); }} />
          <MultiSelect label="Category" options={categoryOptions} selected={category} onChange={(n) => { setCategory(n); setPage(1); }} />
          <label className="muted small">From <input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} /></label>
          <label className="muted small">To <input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} /></label>
        </div>
        {!data ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : <TxsTable txs={data.transactions} showCategory />}
        {data && <Pager page={page} pageSize={PAGE_SIZE} total={data.total} onPage={setPage} />}
      </Panel>
    </div>
  );
}
