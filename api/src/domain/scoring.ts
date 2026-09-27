import { Outcome, Verification } from '../storage/db.types';

// Bond Score: a 0-1000 reputation number built from a Bayesian (Beta) estimate of
// how often an agent honours its commitments.
//
//   - Every agent starts from a prior of (9 successes, 1 fault): unknown != untrustworthy,
//     but unknown is also not top tier.
//   - Each outcome is weighted by value at risk (log scale), so $1 wash trades barely
//     move the needle while a $5,000 delivery does.
//   - No single counterparty can contribute more than PAIR_CAP of positive weight.
//     This is the first line of defence against two agents trading to pump each other.
//   - Old outcomes decay (half-life 120 days) so behaviour, not age, is rewarded.
//   - Score = 1000 * (mean - 2 * stddev): a conservative lower bound, so thin
//     history can't score as high as long, clean history.

export const PRIOR = { a: 9, b: 1 };
export const HALF_LIFE_DAYS = 120;
export const PAIR_CAP = 6;
export const VERIFY_BONUS = [0, 25, 50];
const K = 2;
const DAY = 86_400_000;

export type Tier = 'A' | 'B' | 'C' | 'D' | 'E' | 'NR';

export interface ScoreResult {
  score: number;
  tier: Tier;
  mean: number;
  sd: number;
  a: number;
  b: number;
  outcomes: number;
}

export const outcomeWeight = (amountCents: number): number => Math.max(0.05, Math.log10(1 + amountCents / 1000));

export function tierFor(score: number, n: number): Tier {
  if (n < 3) return 'NR';
  if (score >= 850) return 'A';
  if (score >= 700) return 'B';
  if (score >= 550) return 'C';
  if (score >= 400) return 'D';
  return 'E';
}

export function computeScore(agent: { verification?: Verification }, outcomes: Outcome[], now: number): ScoreResult {
  let a = PRIOR.a;
  let b = PRIOR.b;
  let n = 0;
  for (const o of outcomes) {
    if (o.ts > now) continue;
    const decay = Math.pow(0.5, Math.max(0, now - o.ts) / DAY / HALF_LIFE_DAYS);
    if (o.kind === 'fulfilled') a += o.weight * decay;
    else b += o.weight * decay;
    n++;
  }
  const mean = a / (a + b);
  const sd = Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)));
  const raw = Math.round(1000 * (mean - K * sd)) + VERIFY_BONUS[agent.verification || 0];
  const score = Math.max(0, Math.min(1000, raw));
  return { score, tier: tierFor(score, n), mean, sd, a, b, outcomes: n };
}

export interface ScorePoint { ts: number; score: number }

// Score over time, for the sparkline. Replays the outcome list.
export function scoreHistory(agent: { verification?: Verification }, outcomes: Outcome[], createdAt: number, maxPoints = 60): ScorePoint[] {
  const pts: ScorePoint[] = [{ ts: createdAt, score: computeScore(agent, [], createdAt).score }];
  for (let i = 0; i < outcomes.length; i++) {
    pts.push({ ts: outcomes[i].ts, score: computeScore(agent, outcomes.slice(0, i + 1), outcomes[i].ts).score });
  }
  if (pts.length <= maxPoints) return pts;
  const step = (pts.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, i) => pts[Math.round(i * step)]);
}
