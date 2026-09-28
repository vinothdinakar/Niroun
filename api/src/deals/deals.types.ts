import { Category, Dispute, PoolAccount, Quote, TxStatus, TxTerms } from '../storage/db.types';
import { Violation } from '../domain/policy';
import { PublicAgent } from '../agents/agents.types';
import { PriceResult } from '../domain/pricing';
import { Scope } from '../common/scope';

export interface QuoteInput { counterparty?: unknown; amountCents?: unknown; category?: unknown; coverageCents?: unknown }
export interface CreateTxInput { quoteId?: unknown; terms?: { spec?: unknown; priceCents?: unknown; deliverBy?: unknown } }
export interface EventInput { type?: unknown; data?: Record<string, unknown> }
export interface PricePreviewInput { seller: string | null; amountCents: unknown; category?: unknown; coverageCents?: unknown }

export type QuoteOutcome =
  | { decision: 'declined'; reasons: Violation[] }
  | { decision: 'approved'; quote: Quote };

export interface BriefTx {
  id: string;
  status: TxStatus;
  category: Category;
  buyerId: string;
  buyerName: string | undefined;
  buyerOrgId: string | null;
  sellerId: string;
  sellerName: string | undefined;
  sellerOrgId: string | null;
  amountCents: number;
  coverageCents: number;
  premiumCents: number;
  payoutCents: number;
  createdAt: number;
  updatedAt: number;
  deliverBy: number;
  disputeId: string | null;
}

export interface FullTx extends BriefTx {
  terms: TxTerms;
  termsHash: string;
  events: { seq: number; agentId: string; type: string; data: Record<string, unknown>; ts: number; hash: string }[];
  /** The full dispute record, when `disputeId` is set — one request instead of a second round trip to fetch it. */
  dispute: Dispute | null;
}

/** Filters for the deals list/export: everything optional, AND'ed together. */
export interface DealListOpts {
  scope?: Scope; agent?: string;
  status?: TxStatus[]; category?: Category[];
  search?: string; from?: number; to?: number;
  page?: number; pageSize?: number; limit?: number;
}
export interface DealListResult { rows: BriefTx[]; total: number }

export interface PoolState extends PoolAccount {
  balanceCents: number;
  reservedCoverageCents: number;
  reserveRequiredCents: number;
  maxCoverageCents: number;
}

export type PricePreview = { seller: PublicAgent; amountCents: number; coverageCents: number; capacity: Violation[] } & PriceResult;
