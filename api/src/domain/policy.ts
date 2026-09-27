import { Category, Policy } from '../storage/db.types';
import { CATEGORIES } from './pricing';

// The owner's mandate for an agent: what it is allowed to spend, on what, with whom.
// Enforced server-side on every quote, so a compromised or confused agent can't
// exceed it no matter what its own code does.

export const DEFAULT_POLICY: Policy = {
  perTxLimitCents: 100_000,
  dailyLimitCents: 500_000,
  allowedCategories: null, // null = any
  minCounterpartyScore: 550,
};

export const usd = (cents: number): string =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (x: number): string => (x * 100).toFixed(1) + '%';

const isMoney = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0 && (n as number) <= 1e11;

export interface Violation { code: string; message: string }

export function validatePolicy(p: Record<string, any>): { errors: string[]; policy: Policy } {
  const errors: string[] = [];
  if (!isMoney(p.perTxLimitCents)) errors.push('perTxLimitCents must be a positive integer (cents)');
  if (!isMoney(p.dailyLimitCents)) errors.push('dailyLimitCents must be a positive integer (cents)');
  if (!(Number.isInteger(p.minCounterpartyScore) && p.minCounterpartyScore >= 0 && p.minCounterpartyScore <= 1000)) {
    errors.push('minCounterpartyScore must be an integer 0-1000');
  }
  if (p.allowedCategories !== null) {
    if (!Array.isArray(p.allowedCategories) || p.allowedCategories.some((c: unknown) => !(typeof c === 'string' && c in CATEGORIES))) {
      errors.push(`allowedCategories must be null or a list of: ${Object.keys(CATEGORIES).join(', ')}`);
    }
  }
  return {
    errors,
    policy: {
      perTxLimitCents: p.perTxLimitCents,
      dailyLimitCents: p.dailyLimitCents,
      allowedCategories: p.allowedCategories,
      minCounterpartyScore: p.minCounterpartyScore,
    },
  };
}

export function checkPolicy(
  policy: Policy,
  input: { amountCents: number; category: Category; counterpartyScore: number; spentTodayCents: number },
): Violation[] {
  const { amountCents, category, counterpartyScore, spentTodayCents } = input;
  const v: Violation[] = [];
  if (amountCents > policy.perTxLimitCents) {
    v.push({ code: 'POLICY_PER_TX_LIMIT', message: `${usd(amountCents)} exceeds the per-transaction limit of ${usd(policy.perTxLimitCents)}` });
  }
  if (spentTodayCents + amountCents > policy.dailyLimitCents) {
    v.push({ code: 'POLICY_DAILY_LIMIT', message: `${usd(spentTodayCents + amountCents)} would exceed the 24h limit of ${usd(policy.dailyLimitCents)}` });
  }
  if (policy.allowedCategories && !policy.allowedCategories.includes(category)) {
    v.push({ code: 'POLICY_CATEGORY', message: `Category "${category}" is not in this agent's mandate` });
  }
  if (counterpartyScore < policy.minCounterpartyScore) {
    v.push({ code: 'POLICY_COUNTERPARTY_SCORE', message: `Counterparty score ${counterpartyScore} is below the required ${policy.minCounterpartyScore}` });
  }
  return v;
}
