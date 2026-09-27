import type { ReactNode } from 'react';
import { STATUS, scoreColor } from '../lib/format';

export function Pill({ status }: { status: string }) {
  const [label, color] = STATUS[status] ?? [status, 'gray'];
  return <span className={`pill ${color}`}>{label}</span>;
}

export const StatusPill = ({ suspended }: { suspended: boolean }) =>
  suspended ? <span className="pill red">Suspended</span> : <span className="pill green">Active</span>;

export const Tier = ({ tier }: { tier: string }) => <span className={`tier ${tier}`}>{tier}</span>;

export function ScoreBar({ score }: { score: number }) {
  return <span className="bar"><i style={{ width: `${score / 10}%`, background: scoreColor(score) }} /></span>;
}

/** A card with a small uppercase title and an optional hint, as used across the console. */
export function Panel({ title, hint, children, scrollMax }: { title: string; hint?: ReactNode; children: ReactNode; scrollMax?: number }) {
  return (
    <section className="panel">
      <h2>{title} {hint != null && <small>{hint}</small>}</h2>
      <div className="scroll" style={scrollMax ? { maxHeight: scrollMax } : undefined}>{children}</div>
    </section>
  );
}

/** A card with padding and a plain heading, for forms. */
export function FormPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel pad">
      <h2 className="plain">{title}</h2>
      {children}
    </section>
  );
}

export const EmptyRow = ({ cols, children }: { cols: number; children: ReactNode }) =>
  <tr><td colSpan={cols} className="empty">{children}</td></tr>;

/** Shown when someone reaches a page their role doesn't include (the API refuses the data anyway). */
export function NotAllowed() {
  return <section className="panel pad"><h2 className="plain">Not available</h2><p className="muted">Your role doesn&apos;t include this section.</p></section>;
}
