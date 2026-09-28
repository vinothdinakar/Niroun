import { Injectable } from '@nestjs/common';
import { Document, Filter } from 'mongodb';
import { MongoService } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { LedgerService } from '../core/ledger.service';
import { HttpError, badRequest } from '../common/http-error';
import { Scope } from '../common/scope';
import { Dispute, Tx, User, Verdict } from '../storage/db.types';
import { ArbiterResult, arbitrate } from '../domain/arbiter';
import { AgentsService } from '../agents/agents.service';
import { DealsService } from './deals.service';
import { PoolService } from './pool.service';
import { FullTx } from './deals.types';

const EXPORT_CAP = 10_000;
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type DisputeRow = Dispute & { buyerName?: string; sellerName?: string; amountCents: number; payoutCents: number };

/** Filters for the disputes list/export: everything optional, AND'ed together. */
export interface DisputeListOpts {
  status?: Dispute['status'][]; verdict?: Verdict[];
  search?: string; from?: number; to?: number;
  page?: number; pageSize?: number;
}
export interface DisputeListResult { rows: DisputeRow[]; total: number }

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

  /** Agent-signed: the buyer's own agent files the claim (the normal path — see `openByUser` for the console one). */
  open(agentId: string, txId: string, input: { reason?: unknown }, proof: { reqHash?: string } | null): Promise<{ dispute: Dispute; transaction: FullTx }> {
    return this.mongo.transaction(async () => {
      const tx = await this.deals.txOrThrow(txId);
      if (tx.buyerId !== agentId) throw new HttpError(403, 'WRONG_ROLE', 'Only the buyer may open a dispute');
      return this.fileDispute(tx, input.reason, (d) =>
        this.ledger.log(tx.buyerId, 'dispute_opened', { disputeId: d.id, reason: d.reason }, tx.id, proof));
    });
  }

  /**
   * Console self-service: the buyer's own org (or Bond staff — the caller checks that via `manageable` before
   * calling this) opens the dispute directly, without the agent's own signature. Same state checks and the
   * same arbiter run as the agent path — a human can start a review, never force its outcome. The ledger entry
   * carries `openedBy` so the audit trail always shows this wasn't the agent's own signed action.
   */
  openByUser(actor: Pick<User, 'email'>, tx: Tx, reason: unknown): Promise<{ dispute: Dispute; transaction: FullTx }> {
    return this.mongo.transaction(() => this.fileDispute(tx, reason, (d) =>
      this.ledger.log(tx.buyerId, 'dispute_opened', { disputeId: d.id, reason: d.reason, openedBy: actor.email }, tx.id)));
  }

  private async fileDispute(tx: Tx, rawReason: unknown, logOpened: (d: Dispute) => Promise<unknown>): Promise<{ dispute: Dispute; transaction: FullTx }> {
    if (tx.status !== 'funded' && tx.status !== 'delivered') throw new HttpError(409, 'BAD_STATE', `Cannot dispute while transaction is ${tx.status}`);
    const now = this.clock.now();
    if (tx.status === 'funded' && now <= tx.terms.deliverBy) {
      throw new HttpError(409, 'PREMATURE_DISPUTE', 'The delivery deadline has not passed yet');
    }
    const reason = typeof rawReason === 'string' ? rawReason.slice(0, 1000) : '';
    const d: Dispute = {
      id: newId('dp'), txId: tx.id, buyerId: tx.buyerId, sellerId: tx.sellerId, reason, openedAt: now,
      status: 'open', verdict: null, rule: null, reasons: [], decidedBy: null, resolvedAt: null,
    };
    await this.mongo.disputes.insert(d);
    tx.status = 'disputed';
    tx.disputeId = d.id;
    tx.updatedAt = now;
    await this.mongo.txs.save(tx);
    await logOpened(d);
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

  private hydrateDisputeDocs(docs: Document[]): Dispute[] {
    return docs.map((d) => {
      const { _id, ...rest } = d;
      return { id: _id as string, ...rest } as Dispute;
    });
  }

  private async buildDisputeFilter(scope: Scope, opts: DisputeListOpts): Promise<Filter<Document>> {
    const and: object[] = [];
    if (!scope.all) {
      const visible = await this.mongo.txs.find(await this.agents.txFilter(scope));
      and.push({ txId: { $in: visible.map((t) => t.id) } });
    }
    const { status, verdict, search, from, to } = opts;
    if (status?.length) and.push({ status: { $in: status } });
    if (verdict?.length) and.push({ verdict: { $in: verdict } });
    if (from) and.push({ openedAt: { $gte: from } });
    if (to) and.push({ openedAt: { $lte: to } });
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      const matchedAgentIds = (await this.mongo.agents.find({ name: rx })).map((a) => a.id);
      and.push({ $or: [{ _id: rx }, { txId: rx }, { buyerId: { $in: matchedAgentIds } }, { sellerId: { $in: matchedAgentIds } }] });
    }
    return and.length ? { $and: and } : {};
  }

  /** Attach buyer/seller names and the deal's amount/payout — the one lookup both `list` and `exportRows` need. */
  private async withNamesAndAmounts(disputes: Dispute[]): Promise<DisputeRow[]> {
    const txs = new Map((await this.mongo.txs.getMany([...new Set(disputes.map((d) => d.txId))])).map((t) => [t.id, t]));
    const names = new Map((await this.mongo.agents.getMany([...new Set(disputes.flatMap((d) => [d.buyerId, d.sellerId]))])).map((a) => [a.id, a.name]));
    return disputes.map((d) => ({
      ...d, buyerName: names.get(d.buyerId), sellerName: names.get(d.sellerId),
      amountCents: (txs.get(d.txId) as Tx).terms.priceCents, payoutCents: (txs.get(d.txId) as Tx).payoutCents,
    }));
  }

  /** Without `page`/`pageSize` this returns everything matching, exactly like before — `total` is new, extra. */
  async list(scope: Scope = { all: true }, opts: DisputeListOpts = {}): Promise<DisputeListResult> {
    const filter = await this.buildDisputeFilter(scope, opts);
    const { page, pageSize } = opts;
    const paging = page !== undefined || pageSize !== undefined;
    const size = paging ? Math.min(100, pageSize || 25) : undefined;
    const skip = paging ? Math.max(0, ((page || 1) - 1) * size!) : 0;
    const [docs, total] = await Promise.all([
      this.mongo.col('disputes').find(filter, { sort: { openedAt: -1 }, skip, limit: size, ...this.mongo.tx }).toArray(),
      this.mongo.col('disputes').countDocuments(filter, this.mongo.tx),
    ]);
    return { rows: await this.withNamesAndAmounts(this.hydrateDisputeDocs(docs)), total };
  }

  /** Every row matching the filters (ignores `page`/`pageSize`), capped at 10,000 — for CSV export. */
  async exportRows(scope: Scope, opts: DisputeListOpts): Promise<DisputeRow[]> {
    const filter = await this.buildDisputeFilter(scope, opts);
    const docs = await this.mongo.col('disputes').find(filter, { sort: { openedAt: -1 }, limit: EXPORT_CAP, ...this.mongo.tx }).toArray();
    return this.withNamesAndAmounts(this.hydrateDisputeDocs(docs));
  }
}
