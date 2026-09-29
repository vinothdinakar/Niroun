// The shape of everything Bond stores in MongoDB. Entities with an `id` (agents, quotes, deals, disputes, users, orgs)
// keep it as the document's _id; the others (ledger, outcomes, sessions, ...) are documented where they are used.

export type Verification = 0 | 1 | 2;
export type Category = 'digital_goods' | 'data' | 'physical_goods' | 'services' | 'other' | 'financial' | 'legal';
export type Role = 'admin' | 'reviewer' | 'owner_admin' | 'owner_viewer';
export type AgentStatus = 'active' | 'suspended';

export interface Policy {
  perTxLimitCents: number;
  dailyLimitCents: number;
  allowedCategories: Category[] | null; // null = any
  minCounterpartyScore: number;
}

export interface Agent {
  id: string;
  name: string;
  owner: string;
  orgId: string | null;
  status: AgentStatus;
  publicKey: string;
  policy: Policy;
  verification: Verification;
  createdAt: number;
}

export interface PriceFactors {
  baseFaultProb: number;
  verificationDiscount: number;
  categoryLoad: number;
  sizeLoad: number;
  loading: number;
}

export interface Quote {
  id: string;
  buyerId: string;
  sellerId: string;
  amountCents: number;
  coverageCents: number;
  category: Category;
  premiumCents: number;
  rate: number;
  pd: number | null;
  factors: PriceFactors | null;
  sellerScore: number;
  sellerTier: string;
  createdAt: number;
  expiresAt: number;
  status: 'open' | 'bound';
}

export interface TxTerms {
  spec: string;
  priceCents: number;
  deliverBy: number;
}

export type TxStatus =
  | 'proposed' | 'accepted' | 'funded' | 'delivered' | 'disputed'
  | 'fulfilled' | 'cancelled' | 'expired'
  | 'resolved_seller_fault' | 'resolved_buyer_fault' | 'resolved_denied';

export interface Tx {
  id: string;
  buyerId: string;
  sellerId: string;
  category: Category;
  terms: TxTerms;
  termsHash: string;
  coverageCents: number;
  premiumCents: number;
  quoteId: string;
  status: TxStatus;
  createdAt: number;
  updatedAt: number;
  payoutCents: number;
  flags: { rejected?: boolean };
  deliveredAt?: number;
  disputeId?: string;
  premiumRefunded?: boolean;
}

export type Verdict = 'seller_fault' | 'buyer_fault' | 'not_covered' | 'needs_review';

export interface Dispute {
  id: string;
  txId: string;
  buyerId: string;
  sellerId: string;
  reason: string;
  openedAt: number;
  status: 'open' | 'needs_review' | 'resolved';
  verdict: Verdict | null;
  rule: string | null;
  reasons: string[];
  decidedBy: 'auto' | 'human' | null;
  resolvedAt: number | null;
  reviewedBy?: string | null;
}

export interface LedgerEntry {
  seq: number;
  agentId: string;
  txId: string | null;
  type: string;
  data: Record<string, unknown>;
  ts: number;
  reqHash: string | null;
  prevHash: string;
  hash: string;
}

export interface Outcome {
  ts: number;
  kind: 'fulfilled' | 'fault';
  weight: number;
  amountCents: number;
  txId: string;
  cp: string;
}

export type AccountType = 'individual' | 'business';

export type DocumentKind = 'incorporation' | 'id_document' | 'address_proof';

/** Metadata for one evidence file (the bytes live in the FileStore under `storageKey`). Uploaded first, attached to a
 * request when it is submitted; unattached uploads are cleaned up after a day, attached ones a retention period
 * after the request is decided. `purgedAt` marks a file whose bytes are gone; the record stays as a paper trail. */
export interface VerificationDocument {
  id: string;
  orgId: string;
  kind: DocumentKind;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  storageKey: string;
  uploadedBy: string;
  uploadedAt: number;
  requestId?: string;
  purgedAt?: number;
}

/** A self-service application to move an org from its current verification level to a higher one (KYB for a
 * business, KYC for an individual). One at a time: an org can't have two pending requests. */
export interface VerificationRequest {
  id: string;
  orgId: string;
  accountType: AccountType;
  level: 1 | 2;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  fields: Record<string, string>;
  documentIds: string[];
  submittedBy: string;
  submittedAt: number;
  decidedBy?: string;
  decidedAt?: number;
  rejectionReason?: string;
}

export interface Org {
  id: string;
  name: string;
  accountType: AccountType;
  createdAt: number;
  verification: Verification;
  createdVia: 'staff' | 'signup';
  createdBy?: string;
  // Public-facing profile, edited by the org's own admins. All optional; an empty value clears the field.
  about?: string;
  website?: string;
  contactEmail?: string;
  country?: string;
  industry?: string;
}

export interface TotpRecord { secretEnc: string; enabledAt: number; lastStep: number }

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string | null;
  passwordHash: string | null;
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  inviteHash: string | null;
  inviteExpires: number | null;
  totp: TotpRecord | null;
  totpPending: { secretEnc: string } | null;
  recovery: string[];
  termsVersion?: string;
  termsAcceptedAt?: number;
}

export interface Session { userId: string; createdAt: number; lastSeen: number; mfa: boolean; ip: string; userAgent: string | null }

export interface Enrollment {
  orgId: string;
  createdBy: string;
  label: string;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
  usedAt?: number;
}

export interface PendingSignup {
  email: string;
  name: string;
  company: string;
  accountType: AccountType;
  passwordHash: string;
  verifyHash: string;
  createdAt: number;
  expires: number;
  termsVersion: string;
  termsAcceptedAt: number;
}

export interface AuditEntry {
  ts: number;
  actor: string | null;
  actorEmail: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown>;
}

export interface PoolAccount { capitalCents: number; premiumsCents: number; refundsCents: number; payoutsCents: number }
