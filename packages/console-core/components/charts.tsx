'use client';

import { useRef, useState } from 'react';
import { scoreColor, shortDay, usd0 } from '../lib/format';

const W = 600;
const H = 180;
const PAD_BOTTOM = 24; // room for x-axis day labels
const PLOT_H = H - PAD_BOTTOM;

/** The last `n` UTC day strings ending on `anchorDay` (or today, if there's no data to anchor to). */
function lastNDays(n: number, anchorDay?: string): string[] {
  const end = anchorDay ? new Date(anchorDay + 'T00:00:00Z') : new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - (n - 1 - i)));
    return d.toISOString().slice(0, 10);
  });
}

/** Maps a mouse/touch clientX over an SVG (viewBox width `W`) to the nearest of `n` evenly-spaced points. */
function useNearestIndex(n: number) {
  const ref = useRef<SVGSVGElement>(null);
  const [index, setIndex] = useState<number | null>(null);
  const onMove = (e: React.MouseEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || n < 2) return;
    const x = ((e.clientX - rect.left) / rect.width) * W;
    setIndex(Math.max(0, Math.min(n - 1, Math.round((x / W) * (n - 1)))));
  };
  return { ref, index, onMove, onLeave: () => setIndex(null) };
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

/** A bar with square bottom (baseline) corners and 4px-rounded top corners. */
function barPath(x: number, yTop: number, w: number, h: number): string {
  const r = Math.max(0, Math.min(4, w / 2, h));
  const yBase = yTop + h;
  if (h <= 0) return '';
  return `M${x},${yBase} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + w - r},${yTop} Q${x + w},${yTop} ${x + w},${yTop + r} L${x + w},${yBase} Z`;
}

// ---------- score history (per agent) ----------

export function ScoreHistoryChart({ history }: { history: { ts: number; score: number }[] }) {
  const n = history.length;
  const { ref, index, onMove, onLeave } = useNearestIndex(n);
  if (n < 2) return null;

  const lo = 300, hi = 1000;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (s: number) => PLOT_H - ((Math.max(lo, Math.min(hi, s)) - lo) / (hi - lo)) * (PLOT_H - 8) - 4;
  const pts = history.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const last = history[n - 1];
  const color = scoreColor(last.score);
  const hover = index !== null ? history[index] : null;
  const tiers: [number, string][] = [[850, 'A'], [700, 'B'], [550, 'C'], [400, 'D']];

  return (
    <div className="chart">
      <h4>Score history</h4>
      <div className="chart-svg-wrap">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Bond score over time"
          onMouseMove={onMove} onMouseLeave={onLeave}>
          {tiers.map(([score, label]) => (
            <g key={label}>
              <line x1={0} y1={y(score)} x2={W} y2={y(score)} className="chart-grid" />
              <text x={W} y={y(score) - 3} textAnchor="end" className="chart-axis-label">{label}</text>
            </g>
          ))}
          <polygon points={`0,${PLOT_H} ${pts} ${W},${PLOT_H}`} fill={color} opacity=".12" />
          <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(n - 1)} cy={y(last.score)} r="4" fill={color} stroke="var(--panel)" strokeWidth="2" />
          <text x={x(n - 1)} y={y(last.score) - 10} textAnchor="end" className="chart-end-label">{last.score}</text>
          {hover && (
            <>
              <line x1={x(index!)} y1={0} x2={x(index!)} y2={PLOT_H} className="chart-crosshair" />
              <circle cx={x(index!)} cy={y(hover.score)} r="4" fill={color} stroke="var(--panel)" strokeWidth="2" />
            </>
          )}
        </svg>
        {hover && (
          <div className="chart-tooltip" style={{ left: `${(x(index!) / W) * 100}%` }}>
            <b>{hover.score}</b><span className="muted">{hover.ts ? new Date(hover.ts).toLocaleDateString() : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- spend against mandate (per agent) ----------

export function SpendVsMandateChart({ spend, dailyLimitCents }: { spend: { day: string; spentCents: number }[]; dailyLimitCents: number }) {
  const days = 14;
  const map = new Map(spend.map((p) => [p.day, p.spentCents]));
  const anchor = spend[spend.length - 1]?.day;
  const filled = lastNDays(days, anchor).map((day) => ({ day, spentCents: map.get(day) ?? 0 }));
  const { ref, index, onMove, onLeave } = useNearestIndex(days);

  const maxSpend = Math.max(0, ...filled.map((p) => p.spentCents));
  const maxVal = niceMax(Math.max(dailyLimitCents, maxSpend));
  const slot = W / days;
  const barW = Math.min(24, slot - 6);
  const y = (cents: number) => PLOT_H - (cents / maxVal) * (PLOT_H - 6);
  const limitY = y(dailyLimitCents);
  const hover = index !== null ? filled[index] : null;

  return (
    <div className="chart">
      <h4>Spend vs mandate</h4>
      <div className="chart-svg-wrap">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Daily spend against the 24-hour mandate"
          onMouseMove={onMove} onMouseLeave={onLeave}>
          {filled.map((p, i) => {
            const over = p.spentCents >= dailyLimitCents;
            const x = i * slot + (slot - barW) / 2;
            const h = PLOT_H - y(p.spentCents);
            return (
              <g key={p.day}>
                <rect x={x} y={0} width={barW} height={PLOT_H} fill="transparent" />
                {h > 0 && <path d={barPath(x, y(p.spentCents), barW, h)} fill={over ? 'var(--red)' : 'var(--blue)'} opacity={index === null || index === i ? 1 : 0.45} />}
                {(i % 3 === 0 || i === days - 1) && (
                  <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="chart-axis-label">{shortDay(p.day)}</text>
                )}
              </g>
            );
          })}
          <line x1={0} y1={limitY} x2={W} y2={limitY} className="chart-limit" />
          <text x={W} y={limitY - 4} textAnchor="end" className="chart-axis-label">{usd0(dailyLimitCents)} mandate</text>
        </svg>
        {hover && (
          <div className="chart-tooltip" style={{ left: `${((index! * slot + slot / 2) / W) * 100}%` }}>
            <b>{usd0(hover.spentCents)}</b><span className="muted">{shortDay(hover.day)}</span>
            {hover.spentCents >= dailyLimitCents && <span className="chart-tooltip-flag">over mandate</span>}
          </div>
        )}
      </div>
      <div className="chart-key">
        <span><i className="chart-swatch" style={{ background: 'var(--blue)' }} /> Within mandate</span>
        <span><i className="chart-swatch" style={{ background: 'var(--red)' }} /> Over mandate</span>
      </div>
    </div>
  );
}

// ---------- premium & payout trend (overview) ----------

export function PremiumPayoutChart({ points }: { points: { day: string; premiumCents: number; payoutCents: number }[] }) {
  const days = 30;
  const map = new Map(points.map((p) => [p.day, p]));
  const anchor = points[points.length - 1]?.day;
  const filled = lastNDays(days, anchor).map((day) => map.get(day) ?? { day, premiumCents: 0, payoutCents: 0 });
  const { ref, index, onMove, onLeave } = useNearestIndex(days);

  const maxVal = niceMax(Math.max(0, ...filled.map((p) => Math.max(p.premiumCents, p.payoutCents))));
  const x = (i: number) => (i / (days - 1)) * W;
  const y = (cents: number) => PLOT_H - (cents / maxVal) * (PLOT_H - 6);
  const premiumPts = filled.map((p, i) => `${x(i).toFixed(1)},${y(p.premiumCents).toFixed(1)}`).join(' ');
  const payoutPts = filled.map((p, i) => `${x(i).toFixed(1)},${y(p.payoutCents).toFixed(1)}`).join(' ');
  const hover = index !== null ? filled[index] : null;
  const gridVals = [maxVal, maxVal / 2, 0];

  return (
    <div className="chart">
      <div className="chart-head">
        <h4>Premiums &amp; payouts</h4>
        <div className="chart-legend">
          <span><i className="chart-swatch" style={{ background: 'var(--blue)' }} /> Premiums</span>
          <span><i className="chart-swatch" style={{ background: 'var(--orange)' }} /> Payouts</span>
        </div>
      </div>
      <div className="chart-svg-wrap">
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Daily premiums collected and payouts made, last 30 days"
          onMouseMove={onMove} onMouseLeave={onLeave}>
          {gridVals.map((v) => (
            <g key={v}>
              <line x1={0} y1={y(v)} x2={W} y2={y(v)} className="chart-grid" />
              <text x={0} y={y(v) - 3} className="chart-axis-label">{usd0(v)}</text>
            </g>
          ))}
          <polyline points={premiumPts} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={payoutPts} fill="none" stroke="var(--orange)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          {(index !== null && hover) && (
            <>
              <line x1={x(index)} y1={0} x2={x(index)} y2={PLOT_H} className="chart-crosshair" />
              <circle cx={x(index)} cy={y(hover.premiumCents)} r="4" fill="var(--blue)" stroke="var(--panel)" strokeWidth="2" />
              <circle cx={x(index)} cy={y(hover.payoutCents)} r="4" fill="var(--orange)" stroke="var(--panel)" strokeWidth="2" />
            </>
          )}
          {[0, days - 1].map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : 'end'} className="chart-axis-label">{shortDay(filled[i].day)}</text>
          ))}
        </svg>
        {hover && (
          <div className="chart-tooltip" style={{ left: `${(x(index!) / W) * 100}%` }}>
            <span className="muted">{shortDay(hover.day)}</span>
            <b style={{ color: 'var(--blue)' }}>{usd0(hover.premiumCents)}</b> premiums
            <b style={{ color: 'var(--orange)' }}>{usd0(hover.payoutCents)}</b> payouts
          </div>
        )}
      </div>
    </div>
  );
}
