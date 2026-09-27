import { Category, PoolAccount, Quote, TxStatus, TxTerms } from '../storage/db.types';
import { Violation } from '../domain/policy';
import { PublicAgent } from '../agents/agents.types';
import { PriceResult } from '../domain/pricing';

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
  sellerId: string;
  sellerName: string | undefined;
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
}

export interface PoolState extends PoolAccount {
  balanceCents: number;
  reservedCoverageCents: number;
  reserveRequiredCents: number;
  maxCoverageCents: number;
}

export type PricePreview = { seller: PublicAgent; amountCents: number; coverageCents: number; capacity: Violation[] } & PriceResult;
