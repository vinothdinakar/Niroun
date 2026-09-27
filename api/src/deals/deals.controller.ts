import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Access, AgentId, CallerScope, Proof } from '../common/decorators';
import { Scope } from '../common/scope';
import { DealsService } from './deals.service';
import { DisputesService } from './disputes.service';

type Json = Record<string, unknown>;
type Proofed = { reqHash: string } | null;

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
  async list(@CallerScope() scope: Scope, @Query('agent') agent?: string, @Query('limit') limit?: string) {
    return { transactions: await this.deals.list({ scope, agent: agent || undefined, limit: Number(limit) || 100 }) };
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
  async listDisputes(@CallerScope() scope: Scope) {
    return { disputes: await this.disputes.list(scope) };
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
