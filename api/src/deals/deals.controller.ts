import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Access, AgentId, CallerScope, Proof } from '../common/decorators';
import { Scope } from '../common/scope';
import { csvRow } from '../common/csv';
import { Category, Dispute, TxStatus, Verdict } from '../storage/db.types';
import { DealListOpts } from './deals.types';
import { DealsService } from './deals.service';
import { DisputeListOpts, DisputesService } from './disputes.service';

type Json = Record<string, unknown>;
type Proofed = { reqHash: string } | null;
type Query_ = Record<string, string | undefined>;

const csvList = (v?: string): string[] | undefined => (v ? v.split(',').filter(Boolean) : undefined);
const csvNum = (v?: string): number | undefined => (v ? Number(v) : undefined);

/** Shared by `GET transactions` and `GET transactions/export`: the same filters drive both. */
function parseDealQuery(q: Query_): Omit<DealListOpts, 'scope'> {
  return {
    agent: q.agent || undefined,
    status: csvList(q.status) as TxStatus[] | undefined,
    category: csvList(q.category) as Category[] | undefined,
    search: q.search || undefined,
    from: csvNum(q.from), to: csvNum(q.to),
    page: csvNum(q.page), pageSize: csvNum(q.pageSize), limit: csvNum(q.limit),
  };
}

/** Shared by `GET disputes` and `GET disputes/export`. */
function parseDisputeQuery(q: Query_): DisputeListOpts {
  return {
    status: csvList(q.status) as Dispute['status'][] | undefined,
    verdict: csvList(q.verdict) as Verdict[] | undefined,
    search: q.search || undefined,
    from: csvNum(q.from), to: csvNum(q.to),
    page: csvNum(q.page), pageSize: csvNum(q.pageSize),
  };
}

// The agent-facing deal API (quotes, transactions, events, disputes) and read access to deals.
// Signed agent requests do the writing; agents, staff and customers read what their scope allows.
@Controller('v1')
export class DealsController {
  constructor(private readonly deals: DealsService, private readonly disputes: DisputesService) {}

  @Post('quotes')
  @Access('agent')
  @HttpCode(200)
  quote(@AgentId() agentId: string, @Body() body: Json, @Proof() proof: Proofed) {
    return this.deals.quote(agentId, body, proof);
  }

  @Post('transactions')
  @Access('agent')
  @HttpCode(201)
  async create(@AgentId() agentId: string, @Body() body: Json, @Proof() proof: Proofed) {
    return { transaction: await this.deals.createTransaction(agentId, body, proof) };
  }

  @Get('transactions')
  @Access('any')
  async list(@CallerScope() scope: Scope, @Query() q: Query_) {
    const { rows, total } = await this.deals.list({ scope, ...parseDealQuery(q) });
    return { transactions: rows, total };
  }

  // Declared before `transactions/:id`: a literal path must win over the `:id` route it would otherwise match.
  @Get('transactions/export')
  @Access('any')
  async exportTransactions(@Res() res: Response, @CallerScope() scope: Scope, @Query() q: Query_): Promise<void> {
    const rows = await this.deals.exportRows({ scope, ...parseDealQuery(q) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deals-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write(csvRow(['id', 'status', 'category', 'buyerId', 'buyerName', 'sellerId', 'sellerName', 'amountCents', 'coverageCents', 'premiumCents', 'payoutCents', 'createdAt', 'updatedAt', 'deliverBy', 'disputeId']));
    for (const t of rows) {
      res.write(csvRow([t.id, t.status, t.category, t.buyerId, t.buyerName ?? '', t.sellerId, t.sellerName ?? '', t.amountCents, t.coverageCents, t.premiumCents, t.payoutCents, t.createdAt, t.updatedAt, t.deliverBy, t.disputeId ?? '']));
    }
    res.end();
  }

  @Get('transactions/:id')
  @Access('any')
  async get(@Param('id') id: string, @CallerScope() scope: Scope) {
    return this.deals.fullTx(await this.deals.visibleTx(id, scope));
  }

  @Post('transactions/:id/events')
  @Access('agent')
  @HttpCode(200)
  async event(@AgentId() agentId: string, @Param('id') id: string, @Body() body: Json, @Proof() proof: Proofed) {
    return { transaction: await this.deals.recordEvent(agentId, id, body, proof) };
  }

  @Post('transactions/:id/disputes')
  @Access('agent')
  @HttpCode(200)
  dispute(@AgentId() agentId: string, @Param('id') id: string, @Body() body: Json, @Proof() proof: Proofed) {
    return this.disputes.open(agentId, id, body, proof);
  }

  @Get('disputes')
  @Access('any')
  async listDisputes(@CallerScope() scope: Scope, @Query() q: Query_) {
    const { rows, total } = await this.disputes.list(scope, parseDisputeQuery(q));
    return { disputes: rows, total };
  }

  @Get('disputes/export')
  @Access('any')
  async exportDisputes(@Res() res: Response, @CallerScope() scope: Scope, @Query() q: Query_): Promise<void> {
    const rows = await this.disputes.exportRows(scope, parseDisputeQuery(q));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="disputes-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write(csvRow(['id', 'status', 'verdict', 'rule', 'txId', 'buyerName', 'sellerName', 'amountCents', 'payoutCents', 'openedAt', 'resolvedAt', 'decidedBy', 'reviewedBy', 'reasons']));
    for (const d of rows) {
      res.write(csvRow([d.id, d.status, d.verdict ?? '', d.rule ?? '', d.txId, d.buyerName ?? '', d.sellerName ?? '', d.amountCents, d.payoutCents, d.openedAt, d.resolvedAt ?? '', d.decidedBy ?? '', d.reviewedBy ?? '', d.reasons.join('; ')]));
    }
    res.end();
  }

  @Get('pricing/preview')
  @Access('any')
  preview(
    @Query('seller') seller?: string,
    @Query('amountCents') amountCents?: string,
    @Query('category') category?: string,
    @Query('coverageCents') coverageCents?: string,
  ) {
    return this.deals.previewPrice({ seller: seller ?? null, amountCents, category: category || undefined, coverageCents });
  }
}
