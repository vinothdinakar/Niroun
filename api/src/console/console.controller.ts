import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { Access, CallerScope, CurrentUser, RequirePermission } from '../common/decorators';
import { notFound } from '../common/http-error';
import { Scope } from '../common/scope';
import { AuditService } from '../core/audit.service';
import { MongoService } from '../storage/mongo.service';
import { AgentsService } from '../agents/agents.service';
import { DealsService } from '../deals/deals.service';
import { DisputesService } from '../deals/disputes.service';
import { EnrollmentsService } from '../identity/enrollments.service';
import { OrgsService } from '../identity/orgs.service';
import { UsersService } from '../identity/users.service';
import { isStaff } from '../domain/roles';
import { User } from '../storage/db.types';

type Json = Record<string, unknown>;

// The console API: what staff and customers do from the dashboard. Everything here needs a signed-in person
// (the default for routes with no @Access), and each write is recorded in the audit log with who did it, in the
// same transaction as the change itself: there is no change without its audit entry, and no entry without its change.
// Customers can only act on their own company; staff can act anywhere.
@Controller('v1/console')
export class ConsoleController {
  constructor(
    private readonly mongo: MongoService,
    private readonly audit: AuditService,
    private readonly agents: AgentsService,
    private readonly deals: DealsService,
    private readonly disputes: DisputesService,
    private readonly orgs: OrgsService,
    private readonly users: UsersService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  /** Owner-side actions on an agent: staff anywhere, customers only on agents their organisation owns. */
  private async manageable(user: User, agentId: string): Promise<void> {
    const agent = await this.agents.orThrow(agentId);
    if (!isStaff(user) && agent.orgId !== user.orgId) throw notFound('AGENT_NOT_FOUND', `Unknown agent ${agentId}`);
  }

  // ---- organisations ----
  @Get('orgs')
  async listOrgs(@CurrentUser() user: User) {
    return { orgs: isStaff(user) ? await this.orgs.list() : [await this.orgs.orThrow(user.orgId)] };
  }

  @Post('orgs')
  @RequirePermission('orgs')
  @HttpCode(201)
  createOrg(@CurrentUser() user: User, @Body() body: Json) {
    return this.orgs.create(body.name, user);
  }

  /** Verifying a business also verifies every agent it owns (and later ones inherit it at enrolment). */
  @Post('orgs/:id/verify')
  @HttpCode(200)
  verifyOrg(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.mongo.transaction(async () => {
      const org = await this.orgs.setVerification(user, id, body.level);
      for (const a of await this.agents.ofOrg(org.id)) await this.agents.setVerification(a.id, org.verification);
      return org;
    });
  }

  // ---- people ----
  @Get('users')
  async listUsers(@CurrentUser() user: User) {
    return { users: await this.users.list(user) };
  }

  @Post('users')
  @HttpCode(201)
  invite(@CurrentUser() user: User, @Body() body: Json) {
    return this.users.invite(user, body);
  }

  @Post('users/:id/disable')
  @HttpCode(200)
  disable(@CurrentUser() user: User, @Param('id') id: string) {
    return this.users.setDisabled(user, id, true);
  }

  @Post('users/:id/enable')
  @HttpCode(200)
  enable(@CurrentUser() user: User, @Param('id') id: string) {
    return this.users.setDisabled(user, id, false);
  }

  @Post('users/:id/reset')
  @HttpCode(200)
  reset(@CurrentUser() user: User, @Param('id') id: string) {
    return this.users.reset(user, id);
  }

  @Get('audit')
  @RequirePermission('audit')
  async auditLog() {
    return { entries: await this.audit.list() };
  }

  // ---- agents ----
  @Post('enrollments')
  @HttpCode(201)
  enroll(@CurrentUser() user: User, @Body() body: Json) {
    return this.enrollments.create(user, body.orgId, body.label);
  }

  @Get('agents/:id')
  async agentDetail(@Param('id') id: string, @CallerScope() scope: Scope) {
    await this.agents.assertVisible(scope, id);
    return this.agents.detail(id);
  }

  @Put('agents/:id/policy')
  @RequirePermission('agents_manage')
  setPolicy(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.mongo.transaction(async () => {
      await this.manageable(user, id);
      const out = await this.agents.setPolicyByOwner(id, body, user);
      await this.audit.record(user, 'agent.policy', id, { policy: out.policy });
      return out;
    });
  }

  @Post('agents/:id/status')
  @RequirePermission('agents_suspend')
  @HttpCode(200)
  setStatus(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.mongo.transaction(async () => {
      await this.manageable(user, id);
      const out = await this.agents.setStatus(id, body.status, user);
      await this.audit.record(user, 'agent.status', id, { status: body.status });
      return out;
    });
  }

  @Post('agents/:id/verify')
  @RequirePermission('verify')
  @HttpCode(200)
  verifyAgent(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.mongo.transaction(async () => {
      const out = await this.agents.setVerification(id, body.level);
      await this.audit.record(user, 'agent.verify', id, { level: body.level });
      return out;
    });
  }

  // ---- operations ----
  @Post('disputes/:id/resolve')
  @RequirePermission('resolve')
  @HttpCode(200)
  resolveDispute(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.mongo.transaction(async () => {
      const out = await this.disputes.resolve(id, body, user);
      await this.audit.record(user, 'dispute.resolve', id, { verdict: body.verdict });
      return out;
    });
  }

  @Post('sweep')
  @RequirePermission('sweep')
  @HttpCode(200)
  sweep() {
    return this.deals.sweep();
  }
}
