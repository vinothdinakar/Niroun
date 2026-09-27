import { Injectable } from '@nestjs/common';
import { MongoService, isDuplicateKey, orgNameKey } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { HttpError, badRequest } from '../common/http-error';
import { Org, User, Verification } from '../storage/db.types';
import { Actor } from './identity.types';
import { can } from '../domain/roles';

// Customer companies. A company owns agents and has people who manage them.
@Injectable()
export class OrgsService {
  constructor(private readonly mongo: MongoService, private readonly clock: ClockService, private readonly audit: AuditService) {}

  async create(name: unknown, actor: Actor): Promise<Org> {
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 80) throw badRequest('INVALID_NAME', 'Organization name must be 2-80 characters');
    const clean = name.trim();
    if (await this.nameTaken(clean)) throw new HttpError(409, 'ORG_EXISTS', 'An organization with that name already exists');
    // verification: 0 unverified, 1 owner verified, 2 business verified (KYB). Staff set it; agents of the org inherit it.
    const org: Org = { id: newId('org'), name: clean, createdAt: this.clock.now(), verification: 0, createdVia: 'staff' };
    return this.mongo.transaction(async () => {
      try {
        await this.mongo.orgs.insert(org);
      } catch (e) {
        // two people creating the same name at once: the unique index picks one
        if (isDuplicateKey(e)) throw new HttpError(409, 'ORG_EXISTS', 'An organization with that name already exists');
        throw e;
      }
      await this.audit.record(actor, 'org.create', org.id, { name: clean });
      return org;
    });
  }

  async nameTaken(name: string): Promise<boolean> {
    return (await this.mongo.orgs.count({ nameKey: orgNameKey(name) })) > 0;
  }

  async list(): Promise<Org[]> {
    return (await this.mongo.orgs.find()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async orThrow(id: string | null | undefined): Promise<Org> {
    const o = id ? await this.mongo.orgs.get(id) : null;
    if (!o) throw new HttpError(404, 'ORG_NOT_FOUND', 'Unknown organization');
    return o;
  }

  async setVerification(actor: User, orgId: string, level: unknown): Promise<Org> {
    if (!can(actor, 'verify')) throw new HttpError(403, 'FORBIDDEN', 'Only Bond admins can verify organizations');
    if (level !== 0 && level !== 1 && level !== 2) throw badRequest('INVALID_LEVEL', 'level must be 0, 1 or 2');
    return this.mongo.transaction(async () => {
      const org = await this.orThrow(orgId);
      org.verification = level as Verification;
      await this.mongo.orgs.save(org);
      await this.audit.record(actor, 'org.verify', org.id, { level });
      return org;
    });
  }
}
