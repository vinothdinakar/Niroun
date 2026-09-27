import { Injectable } from '@nestjs/common';
import { MongoService } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { LedgerService } from '../core/ledger.service';
import { HttpError, badRequest } from '../common/http-error';
import { Scope } from '../common/scope';
import { Dispute, Tx, User } from '../storage/db.types';
import { ArbiterResult, arbitrate } from '../domain/arbiter';
import { AgentsService } from '../agents/agents.service';
import { DealsService } from './deals.service';
import { PoolService } from './pool.service';
import { FullTx } from './deals.types';

export type DisputeRow = Dispute & { buyerName?: string; sellerName?: string; amountCents: number; payoutCents: number };

// Disputes: the buyer files a claim, the arbiter reads both parties' signed ledgers, and either pays out,
// denies, or (when the evidence is genuinely ambiguous) hands it to a human reviewer.
@Injectable()
export class DisputesService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly ledger: LedgerService,
    private readonly agents: AgentsService,
    private readonly deals: DealsService,
    private readonly pool: PoolService,
  ) {}

  open(agentId: string, txId: string, input: { reason?: unknown }, proof: { reqHash?: string } | null): Promise<{ dispute: Dispute; transaction: FullTx }> {
    return this.mongo.transaction(async () => {
      const tx = await this.deals.txOrThrow(txId);
      if (tx.buyerId !== agentId) throw new HttpError(403, 'WRONG_ROLE', 'Only the buyer may open a dispute');
      if (tx.status !== 'funded' && tx.status !== 'delivered') throw new HttpError(409, 'BAD_STATE', `Cannot dispute while transaction is ${tx.status}`);
      const now = this.clock.now();
      if (tx.status === 'funded' && now <= tx.terms.deliverBy) {
        throw new HttpError(409, 'PREMATURE_DISPUTE', 'The delivery deadline has not passed yet');
      }
      const reason = typeof input.reason === 'string' ? input.reason.slice(0, 1000) : '';
      const d: Dispute = {
        id: newId('dp'), txId, buyerId: tx.buyerId, sellerId: tx.sellerId, reason, openedAt: now,
        status: 'open', verdict: null, rule: null, reasons: [], decidedBy: null, resolvedAt: null,
      };
      await this.mongo.disputes.insert(d);
      tx.status = 'disputed';
      tx.disputeId = d.id;
      tx.updatedAt = now;
      await this.mongo.txs.save(tx);
      await this.ledger.log(tx.buyerId, 'dispute_opened', { disputeId: d.id, reason }, tx.id, proof);
      await this.ledger.log(tx.sellerId, 'dispute_received', { disputeId: d.id }, tx.id);

      const verdict = arbitrate({ tx, entries: await this.ledger.entriesForTx(tx), integrity: await this.ledger.integrityOf(tx), now });
      if (verdict.verdict === 'needs_review') {
        Object.assign(d, { status: 'needs_review', rule: verdict.rule, reasons: verdict.reasons });
        await this.mongo.disputes.save(d);
      } else {
        await this.applyVerdict(d, verdict, 'auto');
      }
      const finalTx = (await this.mongo.txs.get(tx.id)) as Tx;
      return { dispute: d, transaction: await this.deals.fullTx(finalTx) };
    });
  }

  /** A human reviewer decides a dispute the arbiter couldn't. */
  resolve(disputeId: string, input: { verdict?: unknown; note?: unknown }, reviewer: Pick<User, 'email'> | null = null): Promise<Dispute> {
    return this.mongo.transaction(async () => {
      const d = await this.mongo.disputes.get(disputeId);
      if (!d) throw new HttpError(404, 'DISPUTE_NOT_FOUND', 'Unknown dispute');
      if (d.status !== 'needs_review') throw new HttpError(409, 'BAD_STATE', 'Dispute is not awaiting review');
      const verdict = input.verdict;
      if (verdict !== 'seller_fault' && verdict !== 'buyer_fault' && verdict !== 'not_covered') {
        throw badRequest('INVALID_VERDICT', 'verdict must be seller_fault, buyer_fault or not_covered');
      }
      d.reviewedBy = reviewer?.email ?? null;
      await this.applyVerdict(d, { verdict, rule: 'HUMAN_REVIEW', reasons: [String(input.note || 'Resolved by human reviewer').slice(0, 500)] }, 'human');
      return d;
    });
  }

  private async applyVerdict(d: Dispute, v: ArbiterResult, decidedBy: 'auto' | 'human'): Promise<void> {
    const tx = (await this.mongo.txs.get(d.txId)) as Tx;
    Object.assign(d, { status: 'resolved', verdict: v.verdict, rule: v.rule, reasons: v.reasons, decidedBy, resolvedAt: this.clock.now() });
    tx.updatedAt = this.clock.now();
    if (v.verdict === 'seller_fault') {
      const payout = Math.min(tx.coverageCents, tx.terms.priceCents);
      await this.pool.add('payoutsCents', payout);
      tx.payoutCents = payout;
      tx.status = 'resolved_seller_fault';
      await this.agents.recordOutcome(tx.sellerId, 'fault', tx, tx.buyerId);
    } else if (v.verdict === 'buyer_fault') {
      tx.status = 'resolved_buyer_fault';
      await this.agents.recordOutcome(tx.buyerId, 'fault', tx, tx.sellerId);
      await this.agents.recordOutcome(tx.sellerId, 'fulfilled', tx, tx.buyerId); // seller did their part; protect them
    } else {
      tx.status = 'resolved_denied';
    }
    await this.mongo.txs.save(tx);
    await this.mongo.disputes.save(d);
    for (const id of [tx.buyerId, tx.sellerId]) {
      await this.ledger.log(id, 'dispute_resolved', { disputeId: d.id, verdict: v.verdict, rule: v.rule, payoutCents: tx.payoutCents }, tx.id);
    }
  }

  async list(scope: Scope = { all: true }): Promise<DisputeRow[]> {
    let disputes: Dispute[];
    if (scope.all) {
      disputes = await this.mongo.disputes.find({}, { sort: { openedAt: -1 } });
    } else {
      const visible = await this.mongo.txs.find(await this.agents.txFilter(scope));
      disputes = await this.mongo.disputes.find({ txId: { $in: visible.map((t) => t.id) } }, { sort: { openedAt: -1 } });
    }
    const txs = new Map((await this.mongo.txs.getMany([...new Set(disputes.map((d) => d.txId))])).map((t) => [t.id, t]));
    const names = new Map((await this.mongo.agents.getMany([...new Set(disputes.flatMap((d) => [d.buyerId, d.sellerId]))])).map((a) => [a.id, a.name]));
    return disputes.map((d) => ({
      ...d, buyerName: names.get(d.buyerId), sellerName: names.get(d.sellerId),
      amountCents: (txs.get(d.txId) as Tx).terms.priceCents, payoutCents: (txs.get(d.txId) as Tx).payoutCents,
    }));
  }
}
