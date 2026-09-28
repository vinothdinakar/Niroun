import { AccountType, AgentStatus, Policy, Verification } from '../storage/db.types';
import { ScorePoint, Tier } from '../domain/scoring';
import { ChainCheck } from '../domain/ledger-chain';

/** What anyone signed in may see about an agent: identity and reputation, never its keys or limits. */
export interface PublicAgent {
  id: string;
  name: string;
  owner: string;
  orgId: string | null;
  /** The owning org's type, so verification reads as KYC or KYB; 'business' for an unlinked agent. */
  accountType: AccountType;
  status: AgentStatus;
  verification: Verification;
  createdAt: number;
  score: number;
  tier: Tier;
  faultRate: number;
  outcomes: number;
}

/** One day's spend, for the "spend against mandate" chart. */
export interface SpendPoint { day: string; spentCents: number }

export interface AgentProfile extends PublicAgent {
  history: ScorePoint[];
  spend: SpendPoint[];
  stats: { fulfilled: number; faults: number; volumeCents: number };
  breakdown: { meanSuccess: number; stdDev: number; evidenceWeight: number };
  ledger: { length: number; ok: boolean; headHash: string | null };
}

export type AgentWithPolicy = PublicAgent & { policy: Policy };
export type AgentDetail = AgentProfile & { policy: Policy };
export type { ChainCheck };

export interface RegisterAgentInput {
  name: unknown;
  owner: unknown;
  publicKey: string;
  policy?: Record<string, unknown> | null;
  orgId?: string | null;
  orgName?: string | null;
  orgVerification?: Verification;
}
