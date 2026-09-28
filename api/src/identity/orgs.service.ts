import { Injectable } from '@nestjs/common';
import { MongoService, isDuplicateKey, orgNameKey } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { HttpError, badRequest } from '../common/http-error';
import { AccountType, Org, User, Verification } from '../storage/db.types';
import { Actor } from './identity.types';
import { can } from '../domain/roles';

// Customer companies. A company owns agents and has people who manage them.
@Injectable()
export class OrgsService {
  constructor(private readonly mongo: MongoService, private readonly clock: ClockService, private readonly audit: AuditService) {}

  async create(name: unknown, actor: Actor, accountType: AccountType = 'business'): Promise<Org> {
    if (typeof name !== 'string' || name.trim().length < 2 || name.length > 80) throw badRequest('INVALID_NAME', 'Organization name must be 2-80 characters');
    const clean = name.trim();
    if (await this.nameTaken(clean)) throw new HttpError(409, 'ORG_EXISTS', 'An organization with that name already exists');
    // verification: 0 unverified, 1 owner verified, 2 fully verified (labels differ for individual vs business —
    // see VERIFY_LABELS in the console). Staff set it; agents of the org inherit it.
    const org: Org = { id: newId('org'), name: clean, accountType, createdAt: this.clock.now(), verification: 0, createdVia: 'staff' };
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

  /** Corrects the type an org was created as — e.g. signup guessed wrong, or a staff-created org needs relabelling. */
  async setAccountType(actor: User, orgId: string, accountType: unknown): Promise<Org> {
    if (!can(actor, 'orgs')) throw new HttpError(403, 'FORBIDDEN', 'Only Bond admins can change an organization\'s type');
    if (accountType !== 'individual' && accountType !== 'business') throw badRequest('INVALID_ACCOUNT_TYPE', 'accountType must be "individual" or "business"');
    return this.mongo.transaction(async () => {
      const org = await this.orThrow(orgId);
      org.accountType = accountType;
      await this.mongo.orgs.save(org);
      await this.audit.record(actor, 'org.set_account_type', org.id, { accountType });
      return org;
    });
  }
}
