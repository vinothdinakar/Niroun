import type { DisplayPrefs, Role } from './types';

export const usd = (cents: number): string =>
  '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const usd0 = (cents: number): string => '$' + Math.round(cents / 100).toLocaleString('en-US');

export const NO_DISPLAY_PREFS: DisplayPrefs = { timeZone: null, dateFormat: null, timeFormat: null };

/** The signed-in person's display preferences. The session provider sets it when they sign in or change it, so
 * every date shown through `when` follows it without each screen having to ask. */
let displayPrefs: DisplayPrefs = NO_DISPLAY_PREFS;
export const setDisplayPrefs = (p: Partial<DisplayPrefs> | null | undefined): void => { displayPrefs = { ...NO_DISPLAY_PREFS, ...p }; };

/** A moment as text under the given preferences: their time zone, date order and 12/24-hour clock. With none set it
 * is the browser's own short style, e.g. "Sep 30, 12:52 AM". */
export function formatDateTime(t: number | null | undefined, prefs: DisplayPrefs): string {
  if (!t) return '—';
  const d = new Date(t);
  const timeZone = prefs.timeZone ?? undefined;
  const clock = prefs.timeFormat ? { hourCycle: prefs.timeFormat === '24h' ? 'h23' : 'h12' } as const : {};
  if (!prefs.dateFormat) return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone, ...clock });
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  const date = prefs.dateFormat === 'MDY' ? `${p.month}/${p.day}/${p.year}` : prefs.dateFormat === 'DMY' ? `${p.day}/${p.month}/${p.year}` : `${p.year}-${p.month}-${p.day}`;
  return `${date}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', timeZone, ...clock })}`;
}

export const when = (t: number | null | undefined): string => formatDateTime(t, displayPrefs);

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

/** A short "Browser on OS" label from a raw User-Agent string, for the active-sessions list. Best-effort and
 * cosmetic only — never used for anything security-sensitive — so an unrecognized string just falls back
 * gracefully instead of throwing. Order matters: some browsers' UAs also match another browser's pattern. */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : null;
  return browser && os ? `${browser} on ${os}` : browser || os || 'Unknown device';
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Bond admin', reviewer: 'Bond reviewer', owner_admin: 'Organization owner', owner_viewer: 'Owner viewer',
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
