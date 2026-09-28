import { Injectable } from '@nestjs/common';
import { Document, Filter } from 'mongodb';
import { MongoService } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { LedgerService } from '../core/ledger.service';
import { HttpError, badRequest } from '../common/http-error';
import { Scope } from '../common/scope';
import { Category, Quote, Tx, TxStatus } from '../storage/db.types';
import { canonical, sha256 } from '../domain/canonical';
import { CATEGORIES, MAX_PD, QUOTE_TTL_MS, isCategory, priceQuote } from '../domain/pricing';
import { Violation, checkPolicy, pct } from '../domain/policy';
import { AgentsService } from '../agents/agents.service';
import { PoolService } from './pool.service';
import { BriefTx, CreateTxInput, DealListOpts, DealListResult, EventInput, FullTx, PricePreview, PricePreviewInput, QuoteInput, QuoteOutcome } from './deals.types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const HEX64 = /^[0-9a-f]{64}$/;
const EXPORT_CAP = 10_000;
const round4 = (x: number): number => Math.round(x * 10000) / 10000;
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type EventData = Record<string, string | number | boolean>;
interface EventRule {
  role: 'buyer' | 'seller';
  from: TxStatus[];
  to: TxStatus | ((d: EventData) => TxStatus);
  pick: string[];
  check?: (tx: Tx, d: EventData) => void;
}

// Transaction state machine. `role` is who may send the event.
const EVENT_RULES: Record<string, EventRule> = {
  accept: {
    role: 'seller', from: ['proposed'], to: 'accepted', pick: ['termsHash'],
    check: (tx, d) => {
      if (d.termsHash !== tx.termsHash) throw new HttpError(409, 'TERMS_MISMATCH', 'termsHash does not match the proposed terms');
    },
  },
  decline: { role: 'seller', from: ['proposed'], to: 'cancelled', pick: ['reason'] },
  cancel: { role: 'buyer', from: ['proposed', 'accepted'], to: 'cancelled', pick: ['reason'] },
  payment: {
    role: 'buyer', from: ['accepted'], to: 'funded', pick: ['amountCents'],
    check: (tx, d) => {
      if (d.amountCents !== tx.terms.priceCents) throw badRequest('PAYMENT_MISMATCH', `payment must equal the agreed price (${tx.terms.priceCents})`);
    },
  },
  deliver: {
    role: 'seller', from: ['funded'], to: 'delivered', pick: ['specHash', 'note'],
    check: (_tx, d) => {
      if (!HEX64.test(String(d.specHash ?? ''))) throw badRequest('INVALID_SPEC_HASH', 'specHash must be a sha256 hex digest of what was delivered');
    },
  },
  receipt: {
    role: 'buyer', from: ['delivered'], to: (d) => (d.ok ? 'fulfilled' : 'delivered'), pick: ['ok', 'specHash', 'note'],
    check: (_tx, d) => {
      if (typeof d.ok !== 'boolean') throw badRequest('INVALID_RECEIPT', '"ok" must be a boolean');
      if (d.specHash !== undefined && !HEX64.test(String(d.specHash))) throw badRequest('INVALID_SPEC_HASH', 'specHash must be a sha256 hex digest');
    },
  },
};

// Quotes and deals: pricing a bond, the transaction state machine, settlement, and the expiry sweep.
// Every operation that writes runs in one MongoDB transaction: a deal, the pool, both parties' ledgers and the
// reputation records change together or not at all.
@Injectable()
export class DealsService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly ledger: LedgerService,
    private readonly agents: AgentsService,
    private readonly pool: PoolService,
  ) {}

  async txOrThrow(id: string): Promise<Tx> {
    const t = await this.mongo.txs.get(id);
    if (!t) throw new HttpError(404, 'TX_NOT_FOUND', `Unknown transaction ${id}`);
    return t;
  }

  /** What the buyer's agent has committed to spend since `since`. */
  private async spentSince(buyerId: string, since: number): Promise<number> {
    const [row] = await this.mongo.col('txs')
      .aggregate([
        { $match: { buyerId, createdAt: { $gte: since }, status: { $ne: 'cancelled' } } },
        { $group: { _id: null, sum: { $sum: '$terms.priceCents' } } },
      ], this.mongo.tx)
      .toArray();
    return (row?.sum as number | undefined) ?? 0;
  }

  // ---------- quotes ----------
  quote(buyerId: string, input: QuoteInput, proof: { reqHash?: string } | null): Promise<QuoteOutcome> {
    return this.mongo.transaction(async () => {
      const buyer = await this.agents.orThrow(buyerId);
      const { counterparty, amountCents } = input;
      const category = input.category ?? 'other';
      const seller = await this.agents.orThrow(String(counterparty));
      if (seller.id === buyerId) throw badRequest('SELF_DEAL', 'An agent cannot transact with itself');
      if (!isInt(amountCents) || amountCents <= 0 || amountCents > 1e11) throw badRequest('INVALID_AMOUNT', 'amountCents must be a positive integer');
      if (!isCategory(category)) throw badRequest('INVALID_CATEGORY', `category must be one of: ${Object.keys(CATEGORIES).join(', ')}`);
      const coverageCents = input.coverageCents ?? amountCents;
      if (!isInt(coverageCents) || coverageCents < 0 || coverageCents > amountCents) throw badRequest('INVALID_COVERAGE', 'coverageCents must be an integer between 0 and amountCents');

      const now = this.clock.now();
      const sellerScore = await this.agents.scoreOf(seller);
      const reasons: Violation[] = checkPolicy(buyer.policy, {
        amountCents, category, counterpartyScore: sellerScore.score, spentTodayCents: await this.spentSince(buyerId, now - DAY),
      });

      let pricing: ReturnType<typeof priceQuote> | null = null;
      if (!reasons.length && coverageCents > 0) {
        pricing = priceQuote({ seller, score: sellerScore, amountCents, coverageCents, category });
        if (pricing.declined) {
          reasons.push({ code: 'UNINSURABLE', message: `Counterparty risk too high (estimated fault probability ${pct(pricing.pd)} > ${pct(MAX_PD)})` });
        } else {
          reasons.push(...(await this.pool.capacityReasons(seller.id, coverageCents)));
        }
      }

      if (reasons.length) {
        const type = reasons.some((r) => r.code.startsWith('POLICY_')) ? 'policy_block' : 'quote_declined';
        await this.ledger.log(buyerId, type, { counterparty, amountCents, category, reasons: reasons.map((r) => r.code) }, null, proof);
        return { decision: 'declined', reasons } as QuoteOutcome;
      }

      const priced = pricing && !pricing.declined ? pricing : null;
      const q: Quote = {
        id: newId('qt'), buyerId, sellerId: seller.id, amountCents, coverageCents, category,
        premiumCents: coverageCents > 0 && priced ? priced.premiumCents : 0,
        rate: priced ? round4(priced.rate) : 0,
        pd: priced ? round4(priced.pd) : null,
        factors: priced?.factors ?? null,
        sellerScore: sellerScore.score, sellerTier: sellerScore.tier,
        createdAt: now, expiresAt: now + QUOTE_TTL_MS, status: 'open',
      };
      await this.mongo.quotes.insert(q);
      return { decision: 'approved', quote: q } as QuoteOutcome;
    });
  }

  async previewPrice(input: PricePreviewInput): Promise<PricePreview> {
    const seller = await this.agents.orThrow(String(input.seller));
    const amountCents = Number(input.amountCents);
    const category = input.category ?? 'other';
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) throw badRequest('INVALID_AMOUNT', 'amountCents must be a positive integer');
    if (!isCategory(category)) throw badRequest('INVALID_CATEGORY', 'unknown category');
    const coverageCents = input.coverageCents === undefined ? amountCents : Math.min(Number(input.coverageCents), amountCents);
    const score = await this.agents.scoreOf(seller);
    const p = priceQuote({ seller, score, amountCents, coverageCents, category: category as Category });
    return { seller: await this.agents.publicAgent(seller), amountCents, coverageCents, ...p, capacity: await this.pool.capacityReasons(seller.id, coverageCents) };
  }

  // ---------- transactions ----------
  createTransaction(buyerId: string, input: CreateTxInput, proof: { reqHash?: string } | null): Promise<FullTx> {
    return this.mongo.transaction(async () => {
      const quote = await this.mongo.quotes.get(String(input.quoteId));
      if (!quote || quote.buyerId !== buyerId) throw new HttpError(404, 'QUOTE_NOT_FOUND', 'Unknown quote');
      if (quote.status !== 'open') throw new HttpError(409, 'QUOTE_USED', 'This quote has already been used');
      const now = this.clock.now();
      if (now > quote.expiresAt) throw new HttpError(410, 'QUOTE_EXPIRED', 'Quote expired; request a new one');

      const t = input.terms || {};
      if (typeof t.spec !== 'string' || !t.spec.trim() || t.spec.length > 2000) throw badRequest('INVALID_TERMS', 'terms.spec must be a non-empty string (max 2000 chars)');
      if (t.priceCents !== quote.amountCents) throw badRequest('INVALID_TERMS', 'terms.priceCents must equal the quoted amount');
      if (!isInt(t.deliverBy) || t.deliverBy <= now || t.deliverBy > now + 30 * DAY) throw badRequest('INVALID_TERMS', 'terms.deliverBy must be a future timestamp within 30 days');

      // Commit capacity one bond at a time: take the pool's lock, THEN look at what is free.
      await this.pool.lock();

      const buyer = await this.agents.orThrow(buyerId);
      const seller = await this.agents.orThrow(quote.sellerId);
      const recheck: Violation[] = checkPolicy(buyer.policy, {
        amountCents: quote.amountCents, category: quote.category,
        counterpartyScore: (await this.agents.scoreOf(seller)).score, spentTodayCents: await this.spentSince(buyerId, now - DAY),
      });
      if (quote.coverageCents > 0) recheck.push(...(await this.pool.capacityReasons(seller.id, quote.coverageCents)));
      if (recheck.length) throw new HttpError(409, 'QUOTE_NO_LONGER_VALID', 'Conditions changed since the quote was issued', recheck);

      const terms = { spec: t.spec, priceCents: quote.amountCents, deliverBy: t.deliverBy };
      const tx: Tx = {
        id: newId('tx'), buyerId, sellerId: seller.id, category: quote.category, terms, termsHash: sha256(canonical(terms)),
        coverageCents: quote.coverageCents, premiumCents: quote.premiumCents, quoteId: quote.id,
        status: 'proposed', createdAt: now, updatedAt: now, payoutCents: 0, flags: {},
      };
      await this.mongo.txs.insert(tx);
      quote.status = 'bound';
      await this.mongo.quotes.save(quote);
      await this.pool.add('premiumsCents', tx.premiumCents);
      await this.ledger.log(buyerId, 'terms_proposed', { termsHash: tx.termsHash, terms, sellerId: seller.id, coverageCents: tx.coverageCents, premiumCents: tx.premiumCents }, tx.id, proof);
      await this.ledger.log(seller.id, 'terms_received', { termsHash: tx.termsHash, buyerId }, tx.id);
      return this.fullTx(tx);
    });
  }

  recordEvent(agentId: string, txId: string, input: EventInput, proof: { reqHash?: string } | null): Promise<FullTx> {
    return this.mongo.transaction(async () => {
      const tx = await this.txOrThrow(txId);
      const isBuyer = tx.buyerId === agentId;
      const isSeller = tx.sellerId === agentId;
      if (!isBuyer && !isSeller) throw new HttpError(403, 'NOT_A_PARTY', 'You are not a party to this transaction');
      const type = String(input.type);
      const rule = Object.hasOwn(EVENT_RULES, type) ? EVENT_RULES[type] : undefined;
      if (!rule) throw badRequest('UNKNOWN_EVENT', `type must be one of: ${Object.keys(EVENT_RULES).join(', ')}`);
      if ((rule.role === 'buyer' && !isBuyer) || (rule.role === 'seller' && !isSeller)) {
        throw new HttpError(403, 'WRONG_ROLE', `Only the ${rule.role} may send "${type}"`);
      }
      if (!rule.from.includes(tx.status)) {
        throw new HttpError(409, 'BAD_STATE', `Cannot "${type}" while transaction is ${tx.status}`);
      }

      const data: EventData = {};
      for (const k of rule.pick) {
        const v = input.data?.[k];
        if (v === undefined) continue;
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw badRequest('INVALID_DATA', `${k} must be a string, number or boolean`);
        data[k] = typeof v === 'string' ? v.slice(0, 500) : v;
      }
      rule.check?.(tx, data);

      const now = this.clock.now();
      await this.ledger.log(agentId, type, data, tx.id, proof);
      tx.updatedAt = now;
      tx.status = typeof rule.to === 'function' ? rule.to(data) : rule.to;
      if (type === 'deliver') tx.deliveredAt = now;
      if (type === 'receipt' && !data.ok) tx.flags.rejected = true;
      if (tx.status === 'cancelled') await this.refund(tx);
      if (tx.status === 'fulfilled') await this.settle(tx, 'buyer_receipt');
      await this.mongo.txs.save(tx);
      return this.fullTx(tx);
    });
  }

  private async refund(tx: Tx): Promise<void> {
    await this.pool.add('refundsCents', tx.premiumCents);
    tx.premiumRefunded = true;
  }

  /** Both sides did their part: each gains reputation. (The caller saves `tx`.) */
  private async settle(tx: Tx, via: string): Promise<void> {
    tx.status = 'fulfilled';
    await this.agents.recordOutcome(tx.sellerId, 'fulfilled', tx, tx.buyerId);
    await this.agents.recordOutcome(tx.buyerId, 'fulfilled', tx, tx.sellerId);
    await this.ledger.log(tx.buyerId, 'settled', { via }, tx.id);
    await this.ledger.log(tx.sellerId, 'settled', { via }, tx.id);
  }

  private async expire(tx: Tx, now: number): Promise<void> {
    tx.status = 'expired';
    tx.updatedAt = now;
    await this.ledger.log(tx.buyerId, 'coverage_expired', { reason: 'no claim filed in time' }, tx.id);
  }

  // ---------- housekeeping (run periodically) ----------
  /** Cancel stale proposals, auto-settle silent buyers, expire unclaimed coverage. Each deal is its own transaction. */
  async sweep(): Promise<{ cancelled: number; autoSettled: number; expired: number }> {
    const res = { cancelled: 0, autoSettled: 0, expired: 0 };
    const candidates = await this.mongo.txs.find({ status: { $in: ['proposed', 'accepted', 'funded', 'delivered'] } });
    for (const c of candidates) {
      await this.mongo.transaction(async () => {
        const tx = await this.mongo.txs.get(c.id); // re-read: it may have moved on since the scan
        if (!tx) return;
        const now = this.clock.now();
        if ((tx.status === 'proposed' || tx.status === 'accepted') && now > tx.createdAt + DAY) {
          tx.status = 'cancelled';
          tx.updatedAt = now;
          await this.refund(tx);
          await this.ledger.log(tx.buyerId, 'cancelled', { reason: 'timeout' }, tx.id);
          res.cancelled++;
        } else if (tx.status === 'delivered' && !tx.flags.rejected && now > (tx.deliveredAt ?? 0) + 3 * DAY) {
          tx.updatedAt = now;
          await this.settle(tx, 'auto_after_silence');
          res.autoSettled++;
        } else if (tx.status === 'funded' && now > tx.terms.deliverBy + 7 * DAY) {
          await this.expire(tx, now);
          res.expired++;
        } else if (tx.status === 'delivered' && tx.flags.rejected && now > (tx.deliveredAt ?? 0) + 7 * DAY) {
          await this.expire(tx, now);
          res.expired++;
        } else {
          return;
        }
        await this.mongo.txs.save(tx);
      });
    }
    return res;
  }

  // ---------- read models ----------
  /** Deals as the API shows them, with the parties' names filled in (one lookup for the whole batch). */
  async briefMany(txs: Tx[]): Promise<BriefTx[]> {
    const ids = [...new Set(txs.flatMap((t) => [t.buyerId, t.sellerId]))];
    const agents = new Map((await this.mongo.agents.getMany(ids)).map((a) => [a.id, a]));
    return txs.map((tx) => ({
      id: tx.id, status: tx.status, category: tx.category,
      buyerId: tx.buyerId, buyerName: agents.get(tx.buyerId)?.name, buyerOrgId: agents.get(tx.buyerId)?.orgId ?? null,
      sellerId: tx.sellerId, sellerName: agents.get(tx.sellerId)?.name, sellerOrgId: agents.get(tx.sellerId)?.orgId ?? null,
      amountCents: tx.terms.priceCents, coverageCents: tx.coverageCents, premiumCents: tx.premiumCents,
      payoutCents: tx.payoutCents, createdAt: tx.createdAt, updatedAt: tx.updatedAt, deliverBy: tx.terms.deliverBy,
      disputeId: tx.disputeId ?? null,
    }));
  }

  async fullTx(tx: Tx): Promise<FullTx> {
    const [brief] = await this.briefMany([tx]);
    return {
      ...brief, terms: tx.terms, termsHash: tx.termsHash,
      events: (await this.ledger.entriesForTx(tx)).map(({ seq, agentId, type, data, ts, hash }) => ({ seq, agentId, type, data, ts, hash })),
      dispute: tx.disputeId ? await this.mongo.disputes.get(tx.disputeId) : null,
    };
  }

  /** id/status/... come straight off a Mongo doc; `EntityStore` isn't used here because it has no `skip`. */
  private hydrateTxDocs(docs: Document[]): Tx[] {
    return docs.map((d) => {
      const { _id, ...rest } = d;
      return { id: _id as string, ...rest } as Tx;
    });
  }

  private async buildDealFilter(opts: DealListOpts): Promise<Filter<Document>> {
    const { scope = { all: true }, agent, status, category, search, from, to } = opts;
    const and: object[] = [await this.agents.txFilter(scope)];
    if (agent) and.push({ $or: [{ buyerId: agent }, { sellerId: agent }] });
    if (status?.length) and.push({ status: { $in: status } });
    if (category?.length) and.push({ category: { $in: category } });
    if (from) and.push({ createdAt: { $gte: from } });
    if (to) and.push({ createdAt: { $lte: to } });
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      const matchedAgentIds = (await this.mongo.agents.find({ name: rx })).map((a) => a.id);
      and.push({ $or: [{ _id: rx }, { buyerId: { $in: matchedAgentIds } }, { sellerId: { $in: matchedAgentIds } }] });
    }
    return { $and: and };
  }

  /**
   * Without `page`/`pageSize` this behaves exactly as before (sorted, capped at `limit`, default 500-max) —
   * every existing caller (the Overview's `?limit=60`) is unaffected. `total` is always the full filtered
   * count, an extra field old callers simply don't read.
   */
  async list(opts: DealListOpts = {}): Promise<DealListResult> {
    const { page, pageSize, limit = 100 } = opts;
    const filter = await this.buildDealFilter(opts);
    const paging = page !== undefined || pageSize !== undefined;
    const size = paging ? Math.min(100, pageSize || 25) : Math.min(500, limit);
    const skip = paging ? Math.max(0, ((page || 1) - 1) * size) : 0;
    const [docs, total] = await Promise.all([
      this.mongo.col('txs').find(filter, { sort: { updatedAt: -1, _id: -1 }, skip, limit: size, ...this.mongo.tx }).toArray(),
      this.mongo.col('txs').countDocuments(filter, this.mongo.tx),
    ]);
    return { rows: await this.briefMany(this.hydrateTxDocs(docs)), total };
  }

  /** Every row matching the filters (ignores `page`/`pageSize`), capped at 10,000 — for CSV export. */
  async exportRows(opts: DealListOpts): Promise<BriefTx[]> {
    const filter = await this.buildDealFilter(opts);
    const docs = await this.mongo.col('txs').find(filter, { sort: { updatedAt: -1, _id: -1 }, limit: EXPORT_CAP, ...this.mongo.tx }).toArray();
    return this.briefMany(this.hydrateTxDocs(docs));
  }

  /** A deal the caller is allowed to see, or 404 (so other people's deals don't reveal themselves). */
  async visibleTx(id: string, scope: Scope): Promise<Tx> {
    const tx = await this.txOrThrow(id);
    if (!(await this.agents.txInScope(scope, tx))) throw new HttpError(404, 'TX_NOT_FOUND', `Unknown transaction ${id}`);
    return tx;
  }
}
