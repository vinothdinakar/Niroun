import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Access, AgentId, CallerScope, Proof } from '../common/decorators';
import { Scope } from '../common/scope';
import { LedgerService } from '../core/ledger.service';
import { MongoService } from '../storage/mongo.service';
import { AgentStatus, Org, Verification } from '../storage/db.types';
import { agentIdFromKey } from '../domain/agent-auth';
import { Tier } from '../domain/scoring';
import { csvRow } from '../common/csv';
import { EnrollmentsService } from '../identity/enrollments.service';
import { OrgsService } from '../identity/orgs.service';
import { AgentListOpts, AgentsService } from './agents.service';
import { AgentProfile, AgentWithPolicy, PublicAgent } from './agents.types';

type Json = Record<string, unknown>;
type Proofed = { reqHash: string } | null;
type Query_ = Record<string, string | undefined>;

/** Shared by `GET agents` and `GET agents/export`. */
function parseAgentQuery(q: Query_): AgentListOpts {
  const csvList = (v?: string) => (v ? v.split(',').filter(Boolean) : undefined);
  return {
    search: q.search || undefined,
    status: q.status === 'active' || q.status === 'suspended' ? (q.status as AgentStatus) : undefined,
    tier: csvList(q.tier) as Tier[] | undefined,
    verification: csvList(q.verification)?.map(Number) as Verification[] | undefined,
    page: q.page ? Number(q.page) : undefined,
    pageSize: q.pageSize ? Number(q.pageSize) : undefined,
  };
}

// Agents: the reputation directory (readable by anyone signed in), and the agent's own identity endpoints.
@Controller('v1')
export class AgentsController {
  constructor(
    private readonly mongo: MongoService,
    private readonly agents: AgentsService,
    private readonly ledger: LedgerService,
    private readonly enrollments: EnrollmentsService,
    private readonly orgs: OrgsService,
  ) {}

  @Get('agents')
  @Access('any')
  async list(@Query() q: Query_): Promise<{ agents: PublicAgent[]; total: number }> {
    const { rows, total } = await this.agents.list(parseAgentQuery(q));
    return { agents: rows, total };
  }

  // Declared before `agents/:id`: a literal path must win over the `:id` route it would otherwise match.
  @Get('agents/export')
  @Access('any')
  async exportAgents(@Res() res: Response, @Query() q: Query_): Promise<void> {
    const rows = await this.agents.exportRows(parseAgentQuery(q));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="agents-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.write(csvRow(['id', 'name', 'owner', 'orgId', 'status', 'tier', 'score', 'faultRate', 'verification', 'createdAt']));
    for (const a of rows) {
      res.write(csvRow([a.id, a.name, a.owner, a.orgId ?? '', a.status, a.tier, a.score, a.faultRate, a.verification, a.createdAt]));
    }
    res.end();
  }

  @Get('agents/:id')
  @Access('any')
  profile(@Param('id') id: string): Promise<AgentProfile> {
    return this.agents.profile(id);
  }

  @Get('agents/:id/ledger')
  @Access('any')
  async ledgerOf(@Param('id') id: string, @CallerScope() scope: Scope, @Query() q: Query_) {
    await this.agents.assertVisible(scope, id);
    await this.agents.orThrow(id);
    return this.ledger.recent(id, { page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined });
  }

  /**
   * Self-registration. With an enrollment code, the agent is linked to the organisation that issued it.
   * Claiming the code and registering the agent are one transaction: if registration fails, the code is still good.
   */
  @Post('agents')
  @Access('register')
  @HttpCode(201)
  register(@Body() body: Json, @Proof() proof: Proofed): Promise<PublicAgent> {
    const publicKey = body.publicKey as string;
    return this.mongo.transaction(async () => {
      let org: Org | null = null;
      if (body.enrollmentCode !== undefined) {
        const claimed = await this.enrollments.claim(body.enrollmentCode, agentIdFromKey(publicKey));
        org = await this.orgs.orThrow(claimed.orgId);
      }
      return this.agents.register(
        {
          name: body.name, owner: body.owner, publicKey, policy: (body.policy as Json | null | undefined) ?? null,
          orgId: org?.id ?? null, orgName: org?.name ?? null, orgVerification: org?.verification ?? 0,
        },
        proof,
      );
    });
  }

  @Get('me')
  @Access('agent')
  me(@AgentId() agentId: string): Promise<AgentWithPolicy> {
    return this.agents.me(agentId);
  }

  @Put('me/policy')
  @Access('agent')
  updatePolicy(@AgentId() agentId: string, @Body() body: Json, @Proof() proof: Proofed): Promise<AgentWithPolicy> {
    return this.agents.updateOwnPolicy(agentId, body, proof);
  }
}
