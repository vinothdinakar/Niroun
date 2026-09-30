import { Injectable } from '@nestjs/common';
import { MongoService, isDuplicateKey, orgNameKey } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { HttpError, badRequest } from '../common/http-error';
import { AccountType, Org, User, Verification } from '../storage/db.types';
import { Actor } from './identity.types';
import { can, isStaff } from '../domain/roles';

type ProfileField = 'about' | 'website' | 'contactEmail' | 'country' | 'industry';
const isHttpUrl = (s: string): boolean => {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol);
  } catch {
    return false;
  }
};
const PROFILE_FIELDS: Record<ProfileField, { max: number; check?: (s: string) => boolean; error?: string }> = {
  about: { max: 500 },
  website: { max: 200, check: isHttpUrl, error: 'website must be a full http(s) address, e.g. https://example.com' },
  contactEmail: { max: 120, check: (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s), error: 'contactEmail must be an email address' },
  country: { max: 60 },
  industry: { max: 80 },
};

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

  /**
   * Edits the org's public profile. Only fields present in `input` change (send an empty string to clear one), so a
   * partial update can't wipe the rest. The org's owner admins edit their own; staff can edit any.
   */
  async updateProfile(actor: User, orgId: string, input: Record<string, unknown>): Promise<Org> {
    if (!can(actor, 'org_manage')) throw new HttpError(403, 'FORBIDDEN', 'Only an organization\'s admin can edit its profile');
    if (!isStaff(actor) && actor.orgId !== orgId) throw new HttpError(404, 'ORG_NOT_FOUND', 'Unknown organization'); // don't confirm other orgs exist
    const changes: Partial<Record<ProfileField, string>> = {};
    for (const [key, spec] of Object.entries(PROFILE_FIELDS) as [ProfileField, (typeof PROFILE_FIELDS)[ProfileField]][]) {
      if (!(key in input)) continue;
      const v = input[key];
      if (typeof v !== 'string') throw badRequest('INVALID_PROFILE', `${key} must be text`);
      const clean = v.trim();
      if (clean.length > spec.max) throw badRequest('INVALID_PROFILE', `${key} must be at most ${spec.max} characters`);
      if (clean && spec.check && !spec.check(clean)) throw badRequest('INVALID_PROFILE', spec.error!);
      changes[key] = clean;
    }
    // The organization's name and account type are set later, here, because signup only collects an email and password.
    let name: string | undefined;
    if ('name' in input) {
      if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.trim().length > 80) throw badRequest('INVALID_NAME', 'Organization name must be 2-80 characters');
      name = input.name.trim();
    }
    let accountType: AccountType | undefined;
    if ('accountType' in input) {
      if (input.accountType !== 'individual' && input.accountType !== 'business') throw badRequest('INVALID_ACCOUNT_TYPE', 'accountType must be "individual" or "business"');
      accountType = input.accountType;
    }
    return this.mongo.transaction(async () => {
      const org = await this.orThrow(orgId);
      for (const [key, value] of Object.entries(changes) as [ProfileField, string][]) {
        if (value) org[key] = value;
        else delete org[key];
      }
      const audit: Record<string, unknown> = { fields: Object.keys(changes) };
      if (name !== undefined && name !== org.name) {
        if (orgNameKey(name) !== orgNameKey(org.name) && (await this.nameTaken(name))) throw new HttpError(409, 'ORG_EXISTS', 'An organization with that name already exists');
        audit.name = { from: org.name, to: name };
        org.name = name;
      }
      if (accountType !== undefined && accountType !== org.accountType) {
        // The type decides which evidence verification asks for, so an owner can change it only until verification
        // starts. After that (or any time, for staff) it needs a Bond admin, who can also correct it.
        if (!isStaff(actor) && ((org.verification || 0) > 0 || (await this.mongo.verificationRequests.count({ orgId: org.id, status: 'pending' })) > 0)) {
          throw new HttpError(409, 'ACCOUNT_TYPE_LOCKED', 'The account type cannot be changed once verification has started. Contact Bond support.');
        }
        audit.accountType = { from: org.accountType, to: accountType };
        org.accountType = accountType;
      }
      try {
        await this.mongo.orgs.save(org);
      } catch (e) {
        if (isDuplicateKey(e)) throw new HttpError(409, 'ORG_EXISTS', 'An organization with that name already exists');
        throw e;
      }
      await this.audit.record(actor, 'org.profile_update', org.id, audit);
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
