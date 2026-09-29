import type { Role } from './types';

export const usd = (cents: number): string =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const usd0 = (cents: number): string => '$' + Math.round(cents / 100).toLocaleString('en-US');

export const when = (t: number | null | undefined): string =>
  t ? new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

/** A 'YYYY-MM-DD' day string (as the API's daily aggregates use) as "Sep 21". */
export const shortDay = (day: string): string =>
  new Date(day + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const scoreColor = (s: number): string =>
  s >= 850 ? 'var(--green)' : s >= 700 ? 'var(--accent)' : s >= 550 ? 'var(--amber)' : s >= 400 ? 'var(--orange)' : 'var(--red)';

export const VERIFY = ['Unverified', 'Owner verified', 'Fully verified (KYB)'];

/** Same 3 levels and the same numeric effect (Bond Score bonus, premium discount) as VERIFY — only the label
 * differs, since "Fully verified (KYB)" (Know Your Business) doesn't read right for a personal account. */
export const ORG_VERIFY_LABELS: Record<'individual' | 'business', string[]> = {
  business: VERIFY,
  individual: ['Unverified', 'Verified', 'Fully verified (KYC)'],
};
export const orgVerifyLabel = (level: number, accountType: 'individual' | 'business' | undefined): string =>
  ORG_VERIFY_LABELS[accountType === 'individual' ? 'individual' : 'business'][level] ?? VERIFY[level];

/** The evidence files each account type attaches (mirrors DOC_SPEC on the API). Order is display order. */
export interface VerifyDoc { kind: 'incorporation' | 'id_document' | 'address_proof'; label: string; hint: string; required: boolean }
export const VERIFY_DOC_SPEC: Record<'individual' | 'business', VerifyDoc[]> = {
  business: [
    { kind: 'incorporation', label: 'Certificate of incorporation', hint: 'Or your equivalent registration document', required: true },
    { kind: 'address_proof', label: 'Proof of business address', hint: 'A recent utility bill or bank statement', required: false },
  ],
  individual: [
    { kind: 'id_document', label: 'Photo ID', hint: 'Passport, driver\'s license or national ID', required: true },
    { kind: 'address_proof', label: 'Proof of address', hint: 'A recent utility bill or bank statement', required: false },
  ],
};
export const VERIFY_DOC_LABEL = (accountType: 'individual' | 'business', kind: string): string =>
  VERIFY_DOC_SPEC[accountType].find((d) => d.kind === kind)?.label ?? kind;
export const MAX_DOC_MB = 5;
export const DOC_ACCEPT = 'application/pdf,image/png,image/jpeg';

export const fileSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** What a business vs. an individual has to say about itself to apply for a level (self-attested; staff check
 * it against the uploaded documents above). Order is display order. */
export interface VerifyField { key: string; label: string; placeholder?: string; optional?: boolean }
export const VERIFY_FIELD_SPEC: Record<'individual' | 'business', VerifyField[]> = {
  business: [
    { key: 'legalName', label: 'Legal business name', placeholder: 'Acme Corporation LLC' },
    { key: 'registrationNumber', label: 'Registration number', placeholder: 'EIN, company number, etc.' },
    { key: 'address', label: 'Business address', placeholder: '1 Main St, Springfield' },
    { key: 'website', label: 'Website', placeholder: 'https://…', optional: true },
  ],
  individual: [
    { key: 'legalName', label: 'Legal full name', placeholder: 'Jordan Lee' },
    { key: 'idType', label: 'ID type', placeholder: 'Passport, driver\'s license, national ID…' },
    { key: 'idNumber', label: 'ID number', placeholder: '' },
    { key: 'address', label: 'Address', placeholder: '2 Elm St, Springfield' },
  ],
};

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
