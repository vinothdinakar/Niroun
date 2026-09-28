'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A dropdown button ("Status", "Status (3)") that opens a checkbox list. Unlike a plain menu, clicking an
 * option never closes it — the point is picking several — so it only closes on an outside click or Escape.
 */
export function MultiSelect({ label, options, selected, onChange }: {
  label: string; options: { value: string; label: string }[]; selected: Set<string>; onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = (v: string) => {
    const n = new Set(selected);
    if (n.has(v)) n.delete(v); else n.add(v);
    onChange(n);
  };

  return (
    <div className="multiselect" ref={ref}>
      <button type="button" className="multiselect-btn" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}{selected.size > 0 && <span className="multiselect-count">{selected.size}</span>}
        <span className="multiselect-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="multiselect-panel" role="listbox" aria-label={label}>
          {options.map((o) => (
            <label key={o.value} className="multiselect-option">
              <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} /> {o.label}
            </label>
          ))}
          {selected.size > 0 && (
            <>
              <div className="multiselect-divider" />
              <button type="button" className="multiselect-option multiselect-clear" onClick={() => onChange(new Set())}>Clear ({selected.size})</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A debounced-by-nature search box: the caller owns the value, this just renders the input. */
export function SearchBar({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="search"
      className="search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={placeholder}
    />
  );
}

/** "Page N of M (T total)" plus Prev/Next. Hidden entirely when everything fits on one page. */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <span className="muted small">Page {page} of {pages} ({total.toLocaleString()} total)</span>
      <button className="btn ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
      <button className="btn ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </div>
  );
}

/** A plain same-origin download link — not fetch+blob, so the browser handles the cookie-authenticated download natively. */
export function ExportLink({ href, label = 'Export CSV' }: { href: string; label?: string }) {
  return <a className="btn ghost sm" href={href}>{label}</a>;
}
