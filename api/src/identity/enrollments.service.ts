import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { HttpError, badRequest } from '../common/http-error';
import { Enrollment, User } from '../storage/db.types';
import { sha256 } from '../domain/canonical';
import { can, isStaff } from '../domain/roles';
import { OrgsService } from './orgs.service';

const ENROLL_TTL_MS = 24 * 3_600_000;

// Agent enrolment: an owner admin creates a one-time code; the agent presents it at registration, which
// links the agent to that organisation (and locks its mandate to the owner's control).
// The row's _id is the code's hash. `gcAt` lets MongoDB tidy up long-expired codes.
@Injectable()
export class EnrollmentsService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
  ) {}

  private get col() {
    return this.mongo.col('enrollments');
  }

  async create(actor: User, orgIdInput: unknown, label: unknown = ''): Promise<{ code: string; orgId: string; orgName: string; expiresAt: number }> {
    if (!can(actor, 'enroll')) throw new HttpError(403, 'FORBIDDEN', 'You cannot enroll agents');
    const orgId = isStaff(actor) ? (orgIdInput as string | undefined) : actor.orgId;
    const org = await this.orgs.orThrow(orgId);
    const code = 'enr_' + randomBytes(18).toString('base64url');
    const expiresAt = this.clock.now() + ENROLL_TTL_MS;
    await this.mongo.transaction(async () => {
      await this.col.insertOne(
        {
          _id: sha256(code) as never, orgId: org.id, createdBy: actor.id, label: String(label ?? '').slice(0, 80),
          createdAt: this.clock.now(), expiresAt, usedBy: null, gcAt: new Date(Date.now() + 7 * ENROLL_TTL_MS),
        },
        this.mongo.tx,
      );
      await this.audit.record(actor, 'enrollment.create', org.id, { label });
    });
    return { code, orgId: org.id, orgName: org.name, expiresAt };
  }

  /**
   * Use a code for `agentId`: valid, unexpired, and not used yet, decided by one atomic update so two agents
   * racing with the same code can't both win. Call it inside the same transaction that registers the agent: if
   * registration then fails, the claim is rolled back and the code is still good.
   */
  async claim(code: unknown, agentId: string): Promise<Enrollment> {
    const won = await this.col.findOneAndUpdate(
      { _id: sha256(String(code)) as never, usedBy: null, expiresAt: { $gte: this.clock.now() } },
      { $set: { usedBy: agentId, usedAt: this.clock.now() } },
      { returnDocument: 'after', ...this.mongo.tx },
    );
    if (!won) throw badRequest('INVALID_ENROLLMENT', 'Enrollment code is invalid, expired, or already used');
    return won as unknown as Enrollment;
  }
}
