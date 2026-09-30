import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MongoService, isDuplicateKey } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { HttpError, badRequest } from '../common/http-error';
import { Role, User } from '../storage/db.types';
import { sha256 } from '../domain/canonical';
import { hashPassword, validatePassword } from '../domain/password';
import { normalizeRecovery, seal } from '../domain/totp';
import { OWNER_ROLES, ROLES, can, isStaff } from '../domain/roles';
import { Actor, EMAIL_RE, InviteResult, NO_PREFERENCES, PublicUser, SESSION_IDLE_MS, SESSION_MAX_MS, UserPreferences } from './identity.types';
import { OrgsService } from './orgs.service';
import { SessionsService } from './sessions.service';

const isTimeZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const INVITE_TTL_MS = 7 * 24 * 3_600_000;

interface NewUser { email: unknown; name: unknown; role: unknown; orgId?: string | null; passwordHash?: string | null }

// People who sign in to the console, and the invitations that bring them in.
@Injectable()
export class UsersService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
    private readonly sessions: SessionsService,
    @Inject(BOND_OPTIONS) private readonly options: BondOptions,
  ) {}

  async findByEmail(email: unknown): Promise<User | null> {
    const e = String(email ?? '').trim().toLowerCase();
    return e ? this.mongo.users.findOne({ email: e }) : null;
  }

  /** What the API may show about a person. Pass `orgNames` when converting many, to avoid a lookup each. */
  async publicUser(u: User, orgNames?: Map<string, string>): Promise<PublicUser> {
    const orgName = u.orgId ? orgNames?.get(u.orgId) ?? (await this.mongo.orgs.get(u.orgId))?.name ?? null : null;
    return {
      id: u.id, email: u.email, name: u.name, legalFirstName: u.legalFirstName ?? null, legalLastName: u.legalLastName ?? null,
      role: u.role, orgId: u.orgId, orgName,
      disabled: u.disabled, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, pendingInvite: !u.passwordHash,
      mfa: u.totp?.enabledAt ? 'enabled' : isStaff(u) ? 'required' : 'off',
      recoveryCodesLeft: u.totp?.enabledAt ? u.recovery.length : null,
      emailVerified: !!u.emailVerifiedAt, phone: u.phone ?? null, phoneVerified: !!u.phoneVerifiedAt,
      preferences: { ...NO_PREFERENCES, ...u.preferences },
      sessionPolicy: { absoluteHours: SESSION_MAX_MS / 3_600_000, idleHours: SESSION_IDLE_MS / 3_600_000 },
    };
  }

  /**
   * People edit their own profile: display name (required), and their legal first/last name (optional,
   * self-attested; an empty value clears it). Email, role and organisation are set by whoever invited them.
   */
  async updateProfile(user: User, input: Record<string, unknown>): Promise<PublicUser> {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw badRequest('INVALID_NAME', 'Name must be 1-80 characters');
    const changes: { name: string; legalFirstName?: string | null; legalLastName?: string | null } = { name: input.name.trim() };
    for (const key of ['legalFirstName', 'legalLastName'] as const) {
      if (!(key in input)) continue;
      const v = input[key];
      if (typeof v !== 'string') throw badRequest('INVALID_PROFILE', `${key} must be text`);
      const clean = v.trim();
      if (clean.length > 80) throw badRequest('INVALID_PROFILE', `${key} must be at most 80 characters`);
      changes[key] = clean || null;
    }
    return this.mongo.transaction(async () => {
      const fresh = ((await this.mongo.users.get(user.id)) as User) ?? user;
      Object.assign(fresh, changes);
      await this.mongo.users.save(fresh);
      await this.audit.record(user, 'user.profile_update', user.id, changes);
      return this.publicUser(fresh);
    });
  }

  /**
   * People choose how their own dates and times are shown. Only the keys sent change; null clears one back to
   * "no preference" (the browser's own).
   */
  async updatePreferences(user: User, input: Record<string, unknown>): Promise<PublicUser> {
    const next = { ...NO_PREFERENCES, ...user.preferences };
    if ('timeZone' in input) {
      const tz = input.timeZone;
      if (tz !== null && (typeof tz !== 'string' || !isTimeZone(tz))) throw badRequest('INVALID_PREFERENCE', 'timeZone must be a valid time zone such as "America/Toronto"');
      next.timeZone = tz;
    }
    if ('dateFormat' in input) {
      if (input.dateFormat !== null && !['MDY', 'DMY', 'YMD'].includes(input.dateFormat as string)) throw badRequest('INVALID_PREFERENCE', 'dateFormat must be MDY, DMY or YMD');
      next.dateFormat = input.dateFormat as UserPreferences['dateFormat'];
    }
    if ('timeFormat' in input) {
      if (input.timeFormat !== null && !['12h', '24h'].includes(input.timeFormat as string)) throw badRequest('INVALID_PREFERENCE', 'timeFormat must be 12h or 24h');
      next.timeFormat = input.timeFormat as UserPreferences['timeFormat'];
    }
    return this.mongo.transaction(async () => {
      const fresh = ((await this.mongo.users.get(user.id)) as User) ?? user;
      fresh.preferences = next;
      await this.mongo.users.save(fresh);
      await this.audit.record(user, 'user.preferences_update', user.id, next);
      return this.publicUser(fresh);
    });
  }

  /** Validates and stores a new user. With no password hash the user gets an invitation link to set their own. */
  async insert(input: NewUser, actor: Actor): Promise<{ user: User; inviteToken: string | null }> {
    const email = String(input.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest('INVALID_EMAIL', 'A valid email address is required');
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw badRequest('INVALID_NAME', 'Name must be 1-80 characters');
    if (typeof input.role !== 'string' || !(input.role in ROLES)) throw badRequest('INVALID_ROLE', `role must be one of: ${Object.keys(ROLES).join(', ')}`);
    const role = input.role as Role;
    let orgId = input.orgId ?? null;
    if (OWNER_ROLES.includes(role)) await this.orgs.orThrow(orgId);
    else orgId = null;
    if (await this.findByEmail(email)) throw new HttpError(409, 'USER_EXISTS', 'A user with that email already exists');

    const user: User = {
      id: newId('usr'), email, name: input.name.trim(), legalFirstName: null, legalLastName: null,
      role, orgId, passwordHash: input.passwordHash ?? null, disabled: false,
      createdAt: this.clock.now(), lastLoginAt: null, inviteHash: null, inviteExpires: null,
      totp: null, // set once an authenticator app is confirmed
      totpPending: null, // generated during enrolment, not yet proven
      recovery: [], // sha256 of unused recovery codes
      // Not proven yet: signup sets emailVerifiedAt itself once its own link is clicked (see SignupService.verify).
      emailVerifiedAt: null, emailVerifyHash: null, emailVerifyExpires: null,
      phone: null, phoneVerifiedAt: null, phoneCodeHash: null, phoneCodeExpires: null,
    };
    const inviteToken = user.passwordHash ? null : this.issueInvite(user);
    return this.mongo.transaction(async () => {
      try {
        await this.mongo.users.insert(user);
      } catch (e) {
        if (isDuplicateKey(e)) throw new HttpError(409, 'USER_EXISTS', 'A user with that email already exists'); // the unique index settles races
        throw e;
      }
      await this.audit.record(actor, 'user.create', user.id, { email, role, orgId });
      return { user, inviteToken };
    });
  }

  /** Puts a fresh one-time invitation on the user (the caller saves). Returns the token to send; only its hash is kept. */
  issueInvite(user: User): string {
    const token = randomBytes(24).toString('base64url');
    user.inviteHash = sha256(token);
    user.inviteExpires = this.clock.now() + INVITE_TTL_MS;
    return token;
  }

  /**
   * Trusted/internal creation (seeding, tests): sets a password directly.
   * `totpSecret` (base32) and `recoveryCodes` let seed data and tests create a fully enrolled account.
   */
  async createUser(
    input: { email: string; name: string; role: Role; orgId?: string | null; password: string; totpSecret?: string; recoveryCodes?: string[] },
    actor: Actor = null,
  ): Promise<User> {
    const err = validatePassword(input.password, input.email);
    if (err) throw badRequest('WEAK_PASSWORD', err);
    const passwordHash = await hashPassword(input.password);
    return this.mongo.transaction(async () => {
      const { user } = await this.insert({ ...input, passwordHash }, actor);
      if (input.totpSecret) {
        user.totp = { secretEnc: seal(this.options.encryptionKey, input.totpSecret), enabledAt: this.clock.now(), lastStep: -1 };
        user.recovery = (input.recoveryCodes ?? []).map((c) => sha256(normalizeRecovery(c)));
        await this.mongo.users.save(user);
      }
      return user;
    });
  }

  /** API path: an admin (any role/org) or an owner admin (owner roles, own org) invites someone. */
  async invite(actor: User, input: { email?: unknown; name?: unknown; role?: unknown; orgId?: unknown }): Promise<InviteResult> {
    if (!can(actor, 'team_manage')) throw new HttpError(403, 'FORBIDDEN', 'You cannot manage users');
    let orgId = typeof input.orgId === 'string' ? input.orgId : null;
    if (!isStaff(actor)) {
      if (input.role !== 'owner_admin' && input.role !== 'owner_viewer') throw new HttpError(403, 'FORBIDDEN', 'You can only invite owner_admin or owner_viewer users');
      orgId = actor.orgId;
    }
    const { user, inviteToken } = await this.insert({ email: input.email, name: input.name, role: input.role, orgId }, actor);
    return { user: await this.publicUser(user), inviteToken, inviteExpires: user.inviteExpires };
  }

  /** Redeems an invitation link: the person chooses their own password. Returns the user; sign-in continues from there. */
  async acceptInvite(token: unknown, password: unknown): Promise<User> {
    const h = sha256(String(token ?? ''));
    const found = await this.mongo.users.findOne({ inviteHash: h });
    if (!found || (found.inviteExpires ?? 0) < this.clock.now() || found.disabled) {
      throw new HttpError(400, 'INVALID_INVITE', 'This invitation is invalid or has expired. Ask for a new one.');
    }
    const err = validatePassword(password, found.email);
    if (err) throw badRequest('WEAK_PASSWORD', err);
    const passwordHash = await hashPassword(password as string);
    return this.mongo.transaction(async () => {
      // single use, even if two people click at once: only the request that clears the hash proceeds
      const won = await this.mongo.users.updateOne(
        { _id: found.id as never, inviteHash: h },
        { $set: { passwordHash, inviteHash: null, inviteExpires: null } },
      );
      if (!won) throw new HttpError(400, 'INVALID_INVITE', 'This invitation is invalid or has expired. Ask for a new one.');
      await this.sessions.revokeAll(found.id);
      await this.audit.record(found, 'user.accept_invite', found.id);
      return (await this.mongo.users.get(found.id)) as User;
    });
  }

  private async target(actor: User, id: string): Promise<User> {
    if (!can(actor, 'team_manage')) throw new HttpError(403, 'FORBIDDEN', 'You cannot manage users');
    const u = await this.mongo.users.get(id);
    if (!u || (!isStaff(actor) && u.orgId !== actor.orgId)) throw new HttpError(404, 'USER_NOT_FOUND', 'Unknown user');
    return u;
  }

  async setDisabled(actor: User, id: string, disabled: boolean): Promise<PublicUser> {
    return this.mongo.transaction(async () => {
      const u = await this.target(actor, id);
      if (u.id === actor.id) throw badRequest('SELF_ACTION', 'You cannot disable your own account');
      if (disabled && u.role === 'admin' && (await this.mongo.users.count({ role: 'admin', disabled: false })) <= 1) {
        throw new HttpError(409, 'LAST_ADMIN', 'This is the last active admin');
      }
      u.disabled = !!disabled;
      await this.mongo.users.save(u);
      if (disabled) await this.sessions.revokeAll(u.id);
      await this.audit.record(actor, disabled ? 'user.disable' : 'user.enable', u.id);
      return this.publicUser(u);
    });
  }

  /** Admin-initiated reset: kills sessions and the old password, issues a fresh one-time link. */
  async reset(actor: User, id: string): Promise<InviteResult> {
    return this.mongo.transaction(async () => {
      const u = await this.target(actor, id);
      if (u.id === actor.id) throw badRequest('SELF_ACTION', 'Use "change password" for your own account');
      u.passwordHash = null;
      // A reset also clears their second factor (this is the "I lost my phone and my recovery codes" path);
      // staff enrol a fresh authenticator at next sign-in. Always audited.
      const hadMfa = !!u.totp;
      u.totp = null;
      u.totpPending = null;
      u.recovery = [];
      const inviteToken = this.issueInvite(u);
      await this.mongo.users.save(u);
      await this.sessions.revokeAll(u.id);
      await this.audit.record(actor, 'user.reset', u.id, { mfaCleared: hadMfa });
      return { user: await this.publicUser(u), inviteToken, inviteExpires: u.inviteExpires };
    });
  }

  async list(actor: User): Promise<PublicUser[]> {
    let list: User[];
    if (can(actor, 'orgs')) list = await this.mongo.users.find();
    else if (can(actor, 'team_manage')) list = await this.mongo.users.find({ orgId: actor.orgId });
    else throw new HttpError(403, 'FORBIDDEN', 'You cannot list users');
    const orgIds = [...new Set(list.map((u) => u.orgId).filter((x): x is string => !!x))];
    const orgNames = new Map((await this.mongo.orgs.getMany(orgIds)).map((o) => [o.id, o.name]));
    const people = await Promise.all(list.map((u) => this.publicUser(u, orgNames)));
    return people.sort((a, b) => a.email.localeCompare(b.email));
  }
}
