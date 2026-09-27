import { Injectable } from '@nestjs/common';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from '../core/clock.service';
import { LedgerService } from '../core/ledger.service';
import { Scope } from '../common/scope';
import { AgentsService } from '../agents/agents.service';
import { PoolService } from './pool.service';
import { PoolState } from './deals.types';

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

export interface CustomerOverview {
  agents: number;
  suspended: number;
  transactions: number;
  volumeCents: number;
  openDisputes: number;
  payoutsReceivedCents: number;
  blockedAttempts: number;
}

export interface PlatformStats {
  now: number;
  pool: PoolState;
  lossRatio: number;
  solvencyRatio: number | null;
  volumeCents: number;
  counts: { agents: number; transactions: number; disputes: number; byStatus: Record<string, number> };
}

// Numbers for dashboards: what a customer sees about their own agents, and what staff see about the whole platform.
@Injectable()
export class ReportsService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly ledger: LedgerService,
    private readonly agents: AgentsService,
    private readonly pool: PoolService,
  ) {}

  /** Numbers a customer can see about their own agents (no pool or other customers' data). */
  async overview(scope: Scope): Promise<CustomerOverview> {
    const ids = await this.agents.scopedAgentIds(scope); // null = every agent
    const agents = ids === null ? await this.mongo.agents.find() : await this.mongo.agents.getMany(ids);
    const agentIds = agents.map((a) => a.id);
    const txs = await this.mongo.txs.find(await this.agents.txFilter(scope));
    const mine = new Set(agentIds);
    let volumeCents = 0;
    let payoutsReceivedCents = 0;
    for (const t of txs) {
      if (t.status !== 'cancelled') volumeCents += t.terms.priceCents;
      if (ids === null || mine.has(t.buyerId)) payoutsReceivedCents += t.payoutCents;
    }
    return {
      agents: agents.length,
      suspended: agents.filter((a) => a.status === 'suspended').length,
      transactions: txs.length,
      volumeCents,
      openDisputes: await this.mongo.disputes.count({ status: 'needs_review', txId: { $in: txs.map((t) => t.id) } }),
      payoutsReceivedCents,
      blockedAttempts: await this.ledger.countByType(agentIds, 'policy_block'),
    };
  }

  async stats(): Promise<PlatformStats> {
    const pool = await this.pool.state();
    const rows = await this.mongo.col('txs')
      .aggregate([{ $group: { _id: '$status', n: { $sum: 1 }, cents: { $sum: '$terms.priceCents' } } }], this.mongo.tx)
      .toArray();
    const byStatus: Record<string, number> = {};
    let volumeCents = 0;
    let transactions = 0;
    for (const r of rows) {
      byStatus[r._id as string] = r.n as number;
      transactions += r.n as number;
      if (r._id !== 'cancelled') volumeCents += r.cents as number;
    }
    const netPremiums = pool.premiumsCents - pool.refundsCents;
    return {
      now: this.clock.now(), pool,
      lossRatio: netPremiums > 0 ? round4(pool.payoutsCents / netPremiums) : 0,
      solvencyRatio: pool.reserveRequiredCents > 0 ? round4(pool.balanceCents / pool.reserveRequiredCents) : null,
      volumeCents,
      counts: {
        agents: await this.mongo.agents.count(), transactions, disputes: await this.mongo.disputes.count(), byStatus,
      },
    };
  }
}
