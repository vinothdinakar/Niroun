import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { Access, AgentId, CallerScope, Proof } from '../common/decorators';
import { Scope } from '../common/scope';
import { LedgerService } from '../core/ledger.service';
import { MongoService } from '../storage/mongo.service';
import { Org } from '../storage/db.types';
import { agentIdFromKey } from '../domain/agent-auth';
import { EnrollmentsService } from '../identity/enrollments.service';
import { OrgsService } from '../identity/orgs.service';
import { AgentsService } from './agents.service';
import { AgentProfile, AgentWithPolicy, PublicAgent } from './agents.types';

type Json = Record<string, unknown>;
type Proofed = { reqHash: string } | null;

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
  async list(): Promise<{ agents: PublicAgent[] }> {
    return { agents: await this.agents.list() };
  }

  @Get('agents/:id')
  @Access('any')
  profile(@Param('id') id: string): Promise<AgentProfile> {
    return this.agents.profile(id);
  }

  @Get('agents/:id/ledger')
  @Access('any')
  async ledgerOf(@Param('id') id: string, @CallerScope() scope: Scope) {
    await this.agents.assertVisible(scope, id);
    await this.agents.orThrow(id);
    return this.ledger.recent(id);
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
