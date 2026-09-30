// Shapes returned by the Bond API, as far as the console uses them.

export type Role = 'admin' | 'reviewer' | 'owner_admin' | 'owner_viewer';
export type Permission = 'enroll' | 'team_manage' | 'orgs' | 'audit' | 'resolve' | 'verify' | 'agents_manage' | 'agents_suspend' | (string & {});

/** How a person wants dates and times shown; null is "no preference" (the browser's own). */
export interface DisplayPrefs {
  timeZone: string | null;
  dateFormat: 'MDY' | 'DMY' | 'YMD' | null;
  timeFormat: '12h' | '24h' | null;
}

export interface User {
  id: string;
  email: string;
  name: string;
  /** Self-attested legal name, separate from the display `name` above — for verification/compliance, not shown to a team. */
  legalFirstName: string | null;
  legalLastName: string | null;
  role: Role;
  orgId: string | null;
  orgName: string | null;
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  pendingInvite: boolean;
  mfa: 'enabled' | 'required' | 'off';
  recoveryCodesLeft: number | null;
  /** Whether this account has proved it controls its own email/phone — not identity verification (see Org.verification). */
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  preferences?: DisplayPrefs;
  sessionPolicy?: { absoluteHours: number; idleHours: number };
}

export interface Me { user: User; permissions: Permission[] }

/** One signed-in device/browser, as the "active sessions" list shows it. `id` is an opaque handle for the
 * revoke endpoints, not a secret (it can't be turned back into anything that would let someone sign in). */
export interface SessionRow {
  id: string;
  current: boolean;
  createdAt: number;
  lastSeen: number;
  ip: string;
  userAgent: string | null;
}

/** What sign-in / accept-invite answer: either a finished session, or the step still needed. */
export type SignInResult = Me | { needs: 'totp' | 'enroll'; challenge: string };

export interface Health { ok: boolean; signup: 'open' | 'closed'; devMailbox: boolean }

export interface Policy {
  perTxLimitCents: number;
  dailyLimitCents: number;
  minCounterpartyScore: number;
  allowedCategories: string[] | null;
}

export interface Agent {
  id: string;
  name: string;
  owner: string;
  orgId: string | null;
  /** The owning org's type; older payloads may omit it (read as business). */
  accountType?: 'individual' | 'business';
  tier: string;
  score: number;
  faultRate: number;
  status: 'active' | 'suspended';
  verification: number;
}

export interface AgentProfile extends Agent {
  history: { score: number; ts: number }[];
  spend: { day: string; spentCents: number }[];
  stats: { fulfilled: number; faults: number; volumeCents: number };
}

export interface TrendPoint { day: string; premiumCents: number; payoutCents: number }

export interface LedgerView {
  verification: { ok: boolean; length: number; headHash?: string; brokenAt?: number };
  entries: { ts: number; type: string; data: unknown }[];
  total: number;
}

export interface Tx {
  id: string;
  status: string;
  category?: string;
  buyerId?: string;
  buyerName: string;
  buyerOrgId?: string | null;
  sellerId?: string;
  sellerName: string;
  sellerOrgId?: string | null;
  amountCents: number;
  coverageCents?: number;
  premiumCents: number;
  payoutCents?: number;
  createdAt?: number;
  updatedAt: number;
  deliverBy?: number;
  disputeId?: string | null;
}

export interface DealEvent { seq: number; agentId: string; type: string; data: Record<string, unknown>; ts: number; hash: string }

/** The raw dispute record embedded in a deal's detail — distinct from the row-shaped `Dispute` the list page uses. */
export interface DealDisputeDetail {
  id: string; reason: string; openedAt: number;
  status: 'open' | 'needs_review' | 'resolved';
  verdict: string | null; rule: string | null; reasons: string[];
  decidedBy: 'auto' | 'human' | null; resolvedAt: number | null; reviewedBy?: string | null;
}

export interface DealDetail extends Tx {
  buyerId: string; buyerOrgId: string | null; sellerId: string; sellerOrgId: string | null;
  category: string; createdAt: number; deliverBy: number; disputeId: string | null;
  terms: { spec: string; priceCents: number; deliverBy: number };
  termsHash: string;
  events: DealEvent[];
  dispute: DealDisputeDetail | null;
}

export interface Dispute {
  id: string;
  openedAt: number;
  buyerName: string;
  sellerName: string;
  amountCents: number;
  payoutCents?: number;
  status: string;
  verdict: string;
  rule: string;
  reasons?: string[];
  decidedBy?: string;
  reviewedBy?: string;
}

export interface Org {
  id: string;
  name: string;
  accountType: 'individual' | 'business';
  verification?: number;
  createdVia?: string;
  createdAt: number;
  about?: string;
  website?: string;
  country?: string;
  industry?: string;
}

export type DocumentKind = 'incorporation' | 'id_document' | 'address_proof';

/** An evidence file, as the API describes it (never where its bytes are stored). */
export interface VerificationDocument {
  id: string;
  orgId: string;
  kind: DocumentKind;
  filename: string;
  contentType: string;
  size: number;
  uploadedAt: number;
  requestId?: string;
  purgedAt?: number;
}

export interface VerificationRequest {
  id: string;
  orgId: string;
  accountType: 'individual' | 'business';
  level: 1 | 2;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  fields: Record<string, string>;
  documents: VerificationDocument[];
  submittedBy: string;
  submittedAt: number;
  decidedBy?: string;
  decidedAt?: number;
  rejectionReason?: string;
}

export interface PersonRow extends User {}

export interface AuditEntry { ts: number; actorEmail: string | null; action: string; target?: string; detail: unknown }

export interface PoolStats {
  pool: {
    balanceCents: number; capitalCents: number; reservedCoverageCents: number; maxCoverageCents: number;
    premiumsCents: number; refundsCents: number; payoutsCents: number;
  };
  counts: { transactions: number; disputes: number };
  volumeCents: number;
  lossRatio: number;
  solvencyRatio: number | null;
}

export interface OwnerOverview {
  agents: number; suspended: number; transactions: number; volumeCents: number;
  blockedAttempts: number; payoutsReceivedCents: number; openDisputes: number;
}

export interface Quote {
  declined?: boolean;
  pd: number;
  seller: { name: string; score: number; tier: string };
  coverageCents: number;
  premiumCents: number;
  rate: number;
  factors: { baseFaultProb: number; verificationDiscount: number; categoryLoad: number; sizeLoad: number; loading: number };
  capacity: { message: string }[];
}

export interface InviteResult {
  user: User;
  inviteToken: string | null;
  inviteExpires: number | null;
}

export interface Enrollment { code: string; orgName: string; expiresAt: number }

export interface OutboxMail { to: string; subject: string; text: string; link?: string }

// ---- organization wallet ----
export type WalletSummary =
  | { enabled: false }
  | {
      enabled: true;
      testMode: boolean;
      balance: { availableCents: number; heldCents: number; inTransitCents: number; pendingDepositsCents: number };
      payouts: { status: 'not_setup' | 'incomplete' | 'ready'; bank: { last4: string | null; name: string | null } | null };
      limits: {
        minCents: number; maxDepositCents: number;
        dailyDepositCents: number; usedDepositCents: number;
        dailyWithdrawalCents: number; usedWithdrawalCents: number;
      };
      twoStepEnabled: boolean;
    };

export interface WalletTx {
  id: string;
  type: 'deposit' | 'withdrawal' | 'hold' | 'release' | 'fee';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'canceled';
  amountCents: number;
  feeCents: number;
  chargeCents: number;
  method: 'card' | 'ach' | 'bank' | null;
  description: string;
  createdAt: number;
  balanceAfterCents: number | null;
  failureReason?: string;
}
