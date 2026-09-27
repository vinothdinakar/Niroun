import { Injectable } from '@nestjs/common';
import { MongoService, POOL_ID } from '../storage/mongo.service';
import { TxStatus } from '../storage/db.types';
import { Violation, usd } from '../domain/policy';
import { PoolState } from './deals.types';

export const RESERVE_RATIO = 0.25; // reserve $0.25 per $1 of coverage in force (4x leverage)
export const MAX_SELLER_SHARE = 0.1; // one seller may take at most 10% of total capacity
/** Deals whose coverage is still in force (and therefore reserved against). */
export const ACTIVE: TxStatus[] = ['proposed', 'accepted', 'funded', 'delivered', 'disputed'];

// The reserve pool that backs bonds: how much is held, how much is spoken for, and what it can still take on.
// Money moved is kept as running totals on one document (updated with atomic $inc); what is *reserved* is always
// derived from the live deals, so it can never drift out of step with them.
@Injectable()
export class PoolService {
  constructor(private readonly mongo: MongoService) {}

  private get pool() {
    return this.mongo.col('pool');
  }

  async state(): Promise<PoolState> {
    const p: Record<string, unknown> = (await this.pool.findOne({ _id: POOL_ID as never }, this.mongo.tx)) ?? {};
    const [row] = await this.mongo.col('txs')
      .aggregate([{ $match: { status: { $in: ACTIVE } } }, { $group: { _id: null, sum: { $sum: '$coverageCents' } } }], this.mongo.tx)
      .toArray();
    const reserved = (row?.sum as number | undefined) ?? 0;
    const capitalCents = (p.capitalCents as number | undefined) ?? 0;
    const premiumsCents = (p.premiumsCents as number | undefined) ?? 0;
    const refundsCents = (p.refundsCents as number | undefined) ?? 0;
    const payoutsCents = (p.payoutsCents as number | undefined) ?? 0;
    const balanceCents = capitalCents + premiumsCents - refundsCents - payoutsCents;
    return {
      capitalCents, premiumsCents, refundsCents, payoutsCents,
      balanceCents,
      reservedCoverageCents: reserved,
      reserveRequiredCents: Math.ceil(reserved * RESERVE_RATIO),
      maxCoverageCents: Math.max(0, Math.floor(balanceCents / RESERVE_RATIO)),
    };
  }

  async exposureTo(sellerId: string): Promise<number> {
    const [row] = await this.mongo.col('txs')
      .aggregate([{ $match: { sellerId, status: { $in: ACTIVE } } }, { $group: { _id: null, sum: { $sum: '$coverageCents' } } }], this.mongo.tx)
      .toArray();
    return (row?.sum as number | undefined) ?? 0;
  }

  /** Reasons the pool can't take this coverage on right now (empty = it can). */
  async capacityReasons(sellerId: string, coverageCents: number): Promise<Violation[]> {
    const pool = await this.state();
    if ((pool.reservedCoverageCents + coverageCents) * RESERVE_RATIO > pool.balanceCents) {
      return [{ code: 'POOL_CAPACITY', message: 'Bond does not have enough reserve capital to back this coverage right now' }];
    }
    const cap = Math.floor(pool.maxCoverageCents * MAX_SELLER_SHARE);
    if ((await this.exposureTo(sellerId)) + coverageCents > cap) {
      return [{ code: 'SELLER_CONCENTRATION', message: `Coverage on this seller would exceed the concentration limit of ${usd(cap)}` }];
    }
    return [];
  }

  /** Atomically add to the running money totals (premiums taken, refunds and payouts made). */
  async add(field: 'premiumsCents' | 'refundsCents' | 'payoutsCents', cents: number): Promise<void> {
    if (cents) await this.pool.updateOne({ _id: POOL_ID as never }, { $inc: { [field]: cents } }, this.mongo.tx);
  }

  /**
   * Take the pool's lock for the rest of this transaction. Anything that decides "is there room?" then commits
   * coverage must call this first: two such transactions then queue up instead of both seeing the same free capacity.
   * (The second is transparently retried by MongoDB and re-reads the first one's deals.)
   */
  async lock(): Promise<void> {
    await this.pool.updateOne({ _id: POOL_ID as never }, { $inc: { version: 1 } }, this.mongo.tx);
  }
}
