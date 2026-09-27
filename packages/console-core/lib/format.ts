import type { Role } from './types';

export const usd = (cents: number): string =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const usd0 = (cents: number): string => '$' + Math.round(cents / 100).toLocaleString('en-US');

export const when = (t: number | null | undefined): string =>
  t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

export const scoreColor = (s: number): string =>
  s >= 850 ? 'var(--green)' : s >= 700 ? 'var(--accent)' : s >= 550 ? 'var(--amber)' : s >= 400 ? 'var(--orange)' : 'var(--red)';

export const VERIFY = ['Unverified', 'Owner verified', 'Fully verified (KYB)'];

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Bond admin', reviewer: 'Bond reviewer', owner_admin: 'Owner admin', owner_viewer: 'Owner viewer',
};

export const CATEGORIES = ['digital_goods', 'data', 'physical_goods', 'services', 'other', 'financial', 'legal'];

// [label, colour] for a deal's status pill
export const STATUS: Record<string, [string, string]> = {
  fulfilled: ['Fulfilled', 'green'], resolved_seller_fault: ['Paid out', 'red'], resolved_buyer_fault: ['Claim denied', 'orange'],
  resolved_denied: ['Not covered', 'gray'], disputed: ['In dispute', 'amber'], funded: ['Funded', 'blue'], delivered: ['Delivered', 'blue'],
  accepted: ['Accepted', 'blue'], proposed: ['Proposed', 'blue'], cancelled: ['Cancelled', 'gray'], expired: ['Expired', 'gray'],
};

export const VERDICT: Record<string, [string, string]> = {
  seller_fault: ['Seller at fault', 'red'], buyer_fault: ['Buyer at fault', 'orange'],
  not_covered: ['Not covered', 'gray'], needs_review: ['Needs human review', 'amber'],
};

/** Group a secret into blocks of four for reading aloud / typing: "ABCDEFGH" -> "ABCD EFGH". */
export const groupBy4 = (s: string): string => (s.match(/.{1,4}/g) ?? [s]).join(' ');

/**
 * One-time tokens travel in the URL fragment (`/invite#token=...`), which browsers never send to servers or put in logs.
 * Returns the token, or null when the fragment isn't of that form.
 */
export function tokenFromHash(hash: string): string | null {
  const m = /^#token=([\w-]+)$/.exec(hash);
  return m ? m[1] : null;
}
