// Shapes returned by the Bond API, as far as the console uses them.

export type Role = 'admin' | 'reviewer' | 'owner_admin' | 'owner_viewer';
export type Permission = 'enroll' | 'team_manage' | 'orgs' | 'audit' | 'resolve' | 'verify' | 'agents_manage' | 'agents_suspend' | (string & {});

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  orgId: string | null;
  orgName: string | null;
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  pendingInvite: boolean;
  mfa: 'enabled' | 'required' | 'off';
  recoveryCodesLeft: number | null;
}

export interface Me { user: User; permissions: Permission[] }

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
}

export interface Tx {
  id: string;
  updatedAt: number;
  buyerName: string;
  sellerName: string;
  amountCents: number;
  premiumCents: number;
  payoutCents?: number;
  status: string;
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
  verification?: number;
  createdVia?: string;
  createdAt: number;
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
