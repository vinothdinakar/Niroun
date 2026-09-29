import { Injectable } from '@nestjs/common';
import { MongoService } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { HttpError, badRequest, notFound } from '../common/http-error';
import { Scope } from '../common/scope';
import { AccountType, User, VerificationRequest } from '../storage/db.types';
import { can } from '../domain/roles';
import { OrgsService } from './orgs.service';
import { DocumentView, VerificationDocumentsService } from './verification-documents.service';

/** A request as the console sees it: with the metadata of its evidence files. */
export type VerificationRequestView = VerificationRequest & { documents: DocumentView[] };

// What a business vs. an individual needs to say about themselves to move up a verification level.
// Self-attested — nobody checks a passport number against anything — same fidelity as the rest of this
// simulated-funds preview: it's a real process (apply, review, decide), just not a real document check.
const FIELD_SPEC: Record<AccountType, string[]> = {
  business: ['legalName', 'registrationNumber', 'address', 'website'],
  individual: ['legalName', 'idType', 'idNumber', 'address'],
};
const OPTIONAL_FIELDS = new Set(['website']);
const MAX_FIELD_LEN = 200;

// Self-service applications to raise an org's verification level (KYB for a business, KYC for an individual).
// One pending request per org at a time; staff (see ConsoleController) approve or reject it.
@Injectable()
export class VerificationRequestsService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
    private readonly documents: VerificationDocumentsService,
  ) {}

  private get col() {
    return this.mongo.verificationRequests;
  }

  fieldSpec(accountType: AccountType): string[] {
    return FIELD_SPEC[accountType];
  }

  async submit(user: User, levelInput: unknown, fieldsInput: Record<string, unknown>, documentIds: unknown): Promise<VerificationRequestView> {
    if (!can(user, 'request_verification')) throw new HttpError(403, 'FORBIDDEN', 'Only an organization\'s own admin can apply for verification');
    if (levelInput !== 1 && levelInput !== 2) throw badRequest('INVALID_LEVEL', 'level must be 1 or 2');
    const level = levelInput as 1 | 2;
    const org = await this.orgs.orThrow(user.orgId);
    if (level <= (org.verification || 0)) throw badRequest('ALREADY_AT_LEVEL', `${org.name} is already at or above that level`);
    if (await this.col.findOne({ orgId: org.id, status: 'pending' })) {
      throw new HttpError(409, 'REQUEST_PENDING', 'You already have a verification request awaiting review');
    }
    const fields: Record<string, string> = {};
    for (const key of FIELD_SPEC[org.accountType]) {
      const v = String(fieldsInput?.[key] ?? '').trim();
      if (!v) {
        if (OPTIONAL_FIELDS.has(key)) continue;
        throw badRequest('MISSING_FIELD', `${key} is required`);
      }
      if (v.length > MAX_FIELD_LEN) throw badRequest('FIELD_TOO_LONG', `${key} must be under ${MAX_FIELD_LEN} characters`);
      fields[key] = v;
    }
    const req: VerificationRequest = {
      id: newId('ver'), orgId: org.id, accountType: org.accountType, level, status: 'pending',
      fields, documentIds: [], submittedBy: user.id, submittedAt: this.clock.now(),
    };
    return this.mongo.transaction(async () => {
      req.documentIds = await this.documents.attach(org.id, org.accountType, req.id, documentIds);
      await this.col.insert(req);
      await this.audit.record(user, 'verification.request', req.id, { orgId: org.id, level, documents: req.documentIds.length });
      return (await this.withDocuments([req]))[0];
    });
  }

  /** `scope.all` (staff): every request, newest first. Otherwise: one org's own history. */
  async list(scope: Scope): Promise<VerificationRequestView[]> {
    const filter = scope.all ? {} : { orgId: scope.orgId };
    return this.withDocuments(await this.col.find(filter, { sort: { submittedAt: -1 } }));
  }

  private async withDocuments(requests: VerificationRequest[]): Promise<VerificationRequestView[]> {
    const docs = await this.documents.forRequests(requests.flatMap((r) => r.documentIds ?? []));
    return requests.map((r) => ({ ...r, documents: (r.documentIds ?? []).flatMap((id) => docs.get(id) ?? []) }));
  }

  async orThrow(id: string): Promise<VerificationRequest> {
    const r = await this.col.get(id);
    if (!r) throw notFound('REQUEST_NOT_FOUND', `Unknown verification request ${id}`);
    return r;
  }

  /** Marks the request decided. Approving an org's actual verification level is the caller's job (ConsoleController),
   * since that also has to cascade to the org's agents — this only owns the request's own lifecycle. */
  async decide(actor: User, id: string, approve: boolean, reason?: unknown): Promise<VerificationRequest> {
    if (!can(actor, 'verify')) throw new HttpError(403, 'FORBIDDEN', 'Only Bond admins can decide verification requests');
    return this.mongo.transaction(async () => {
      const req = await this.orThrow(id);
      if (req.status !== 'pending') throw new HttpError(409, 'ALREADY_DECIDED', 'This request was already decided');
      req.status = approve ? 'approved' : 'rejected';
      req.decidedBy = actor.id;
      req.decidedAt = this.clock.now();
      if (!approve) req.rejectionReason = String(reason ?? '').trim().slice(0, 500) || 'No reason given';
      await this.col.save(req);
      await this.audit.record(actor, approve ? 'verification.approve' : 'verification.reject', req.id, { orgId: req.orgId, level: req.level });
      return req;
    });
  }
}
