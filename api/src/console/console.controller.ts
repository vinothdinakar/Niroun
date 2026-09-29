import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
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
import { VerificationDocumentsService } from '../identity/verification-documents.service';
import { VerificationRequestsService } from '../identity/verification-requests.service';
import { BondRequest } from '../common/request';
import { isStaff } from '../domain/roles';
import { Org, User } from '../storage/db.types';

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
    private readonly verificationRequests: VerificationRequestsService,
    private readonly verificationDocuments: VerificationDocumentsService,
  ) {}

  /** Owner-side actions on an agent: staff anywhere, customers only on agents their organisation owns. */
  private async manageable(user: User, agentId: string): Promise<void> {
    const agent = await this.agents.orThrow(agentId);
    if (!isStaff(user) && agent.orgId !== user.orgId) throw notFound('AGENT_NOT_FOUND', `Unknown agent ${agentId}`);
  }

  /** Sets the org's verification level and cascades it to every agent it currently owns. */
  private async applyVerification(user: User, orgId: string, level: unknown): Promise<Org> {
    const org = await this.orgs.setVerification(user, orgId, level);
    for (const a of await this.agents.ofOrg(org.id)) await this.agents.setVerification(a.id, org.verification);
    return org;
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
    const accountType = body.accountType === 'individual' ? 'individual' : 'business';
    return this.orgs.create(body.name, user, accountType);
  }

  /** Verifying a business also verifies every agent it owns (and later ones inherit it at enrolment). */
  @Post('orgs/:id/verify')
  @HttpCode(200)
  verifyOrg(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.mongo.transaction(() => this.applyVerification(user, id, body.level));
  }

  /** The org's profile (about, website, contact, country, industry). Partial: only the fields sent change. */
  @Put('orgs/:id/profile')
  @RequirePermission('org_manage')
  updateOrgProfile(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.orgs.updateProfile(user, id, body);
  }

  /** Corrects an org's type (e.g. signup guessed wrong, or a staff-created one needs relabelling). Doesn't touch verification. */
  @Post('orgs/:id/account-type')
  @RequirePermission('orgs')
  @HttpCode(200)
  setOrgAccountType(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.orgs.setAccountType(user, id, body.accountType);
  }

  // ---- verification (KYB/KYC) requests ----
  /** An org's own admin applies to move up a level, describing itself with the fields that level (Score/premium). */
  @Post('verification-requests')
  @RequirePermission('request_verification')
  @HttpCode(201)
  submitVerificationRequest(@CurrentUser() user: User, @Body() body: Json) {
    return this.verificationRequests.submit(user, body.level, (body.fields as Json) ?? {}, body.documentIds);
  }

  /** One evidence file (PDF/PNG/JPEG, up to 5 MB): the body is the file itself, the rest is in the query string.
   * Upload first, then name the returned ids in the application. */
  @Post('verification-documents')
  @RequirePermission('request_verification')
  @HttpCode(201)
  uploadVerificationDocument(@CurrentUser() user: User, @Req() req: BondRequest, @Query('kind') kind: string, @Query('filename') filename: string) {
    return this.verificationDocuments.upload(user, kind, filename, req.headers['content-type'], req.upload);
  }

  /** Downloads an evidence file: staff reviewing an application, or the org that uploaded it. Never a public link. */
  @Get('verification-documents/:id')
  async downloadVerificationDocument(@CurrentUser() user: User, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const { doc, data } = await this.verificationDocuments.read(user, id);
    res.setHeader('Content-Type', doc.contentType);
    const ascii = doc.filename.replace(/[^ -~]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
    res.setHeader('Content-Length', String(data.length));
    res.end(data);
  }

  /** Staff see every request (their review queue); an org sees only its own history. */
  @Get('verification-requests')
  listVerificationRequests(@CallerScope() scope: Scope) {
    return this.verificationRequests.list(scope).then((requests) => ({ requests }));
  }

  /** The applicant takes a pending application back to edit and resubmit it. */
  @Post('verification-requests/:id/withdraw')
  @RequirePermission('request_verification')
  @HttpCode(200)
  withdrawVerificationRequest(@CurrentUser() user: User, @Param('id') id: string) {
    return this.verificationRequests.withdraw(user, id);
  }

  /** Approving also sets the org's verification level (and cascades to its agents); rejecting just records why. */
  @Post('verification-requests/:id/decide')
  @RequirePermission('verify')
  @HttpCode(200)
  decideVerificationRequest(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.mongo.transaction(async () => {
      const approve = body.decision === 'approve';
      const request = await this.verificationRequests.decide(user, id, approve, body.reason);
      const org = approve ? await this.applyVerification(user, request.orgId, request.level) : undefined;
      return { request, org };
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
  /**
   * Self-service: the buyer's own org (or staff) opens a dispute without the agent's own signature — for when
   * the agent's own integration never calls this itself. Same arbiter run as the agent path; a human can only
   * start a review here, never decide it. `manageable` keeps this to your own org's agents (staff: anywhere).
   */
  @Post('transactions/:id/disputes')
  @RequirePermission('agents_manage')
  @HttpCode(200)
  openDispute(@CurrentUser() user: User, @Param('id') id: string, @Body() body: Json) {
    return this.mongo.transaction(async () => {
      const tx = await this.deals.txOrThrow(id);
      await this.manageable(user, tx.buyerId);
      const out = await this.disputes.openByUser(user, tx, body.reason);
      await this.audit.record(user, 'dispute.open', out.dispute.id, { txId: id, reason: body.reason });
      return out;
    });
  }

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
