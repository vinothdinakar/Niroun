import { Injectable } from '@nestjs/common';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { RateLimitService } from '../core/rate-limit.service';
import { HttpError, badRequest } from '../common/http-error';
import { PendingSignup, User } from '../storage/db.types';
import { dummyHash, hashPassword, validatePassword, verifyPassword } from '../domain/password';
import { isStaff } from '../domain/roles';
import { SignInStep } from './identity.types';
import { MfaService } from './mfa.service';
import { SessionMeta, SessionsService } from './sessions.service';
import { UsersService } from './users.service';

const EMAIL_MAX_FAILS = 5;
const IP_MAX_FAILS = 30;

// Sign-in: password first, then whatever else the account requires. A session (and its cookie) exists only
// once every required step has passed.
@Injectable()
export class AuthService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly rate: RateLimitService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly mfa: MfaService,
  ) {}

  async login(email: unknown, password: unknown, ip = 'unknown', remember = true, meta: SessionMeta = {}): Promise<SignInStep> {
    const key = String(email ?? '').trim().toLowerCase();
    if (this.rate.isLocked(`e:${key}`, EMAIL_MAX_FAILS) || this.rate.isLocked(`i:${ip}`, IP_MAX_FAILS)) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many failed attempts. Try again in 15 minutes.');
    }
    const user = await this.users.findByEmail(key);
    // Verify against a dummy hash for unknown users, so "no such user" costs the same as "wrong password".
    const ok = await verifyPassword(String(password ?? ''), user?.passwordHash ?? (await dummyHash()));
    if (!user || !user.passwordHash || user.disabled || !ok) {
      // Unknown emails also check for a pending signup (one more hash); do the same work for known ones so timing can't tell them apart.
      if (!user) await this.throwIfPendingSignup(key, String(password ?? ''));
      else await verifyPassword(String(password ?? ''), await dummyHash());
      this.rate.recordFailure(`e:${key}`);
      this.rate.recordFailure(`i:${ip}`);
      await this.audit.record(null, 'login.failed', user?.id ?? null, { email: key });
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }
    this.rate.clear(`e:${key}`);
    await this.audit.record(user, 'login.password_ok', user.id);
    return this.afterPassword(user, remember, { ip, ...meta });
  }

  // A signup whose emailed link hasn't been used yet has no account, so the password check above can't succeed.
  // If the person gives the password they chose at signup, say so (the sign-in page then points them at the
  // "check your email" screen). This is only ever revealed to someone who knows that password, so it can't be used
  // to find out which addresses have signed up. Everyone else gets the same generic error as always.
  private async throwIfPendingSignup(email: string, password: string): Promise<void> {
    const rec = (await this.mongo.col('signups').findOne({ _id: email as never })) as unknown as PendingSignup | null;
    const ok = await verifyPassword(password, rec?.passwordHash ?? (await dummyHash()));
    if (!rec || !ok || rec.expires < this.clock.now()) return;
    await this.audit.record(null, 'login.unverified_signup', null, { email });
    throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address. Check your inbox for the verification link.');
  }

  /** The person chose their password from an invitation link; staff still must set up two-factor before getting a session. */
  async acceptInvite(token: unknown, password: unknown, meta: SessionMeta = {}): Promise<SignInStep> {
    const user = await this.users.acceptInvite(token, password);
    return this.afterPassword(user, true, meta);
  }

  // The password is correct. Who still needs a second factor?
  //   - anyone enrolled: must present a code
  //   - staff not yet enrolled: must enrol now (they can't skip it)
  //   - everyone else: signed in
  // `remember` decides whether the eventual session cookie survives closing the browser; it just rides along
  // through the challenge for anyone who still has a second factor to clear. `meta` (IP, user agent) rides
  // along the same way, so it still describes this sign-in once the session is finally created.
  private async afterPassword(user: User, remember: boolean, meta: SessionMeta = {}): Promise<SignInStep> {
    if (user.totp?.enabledAt) return { needs: 'totp', challenge: this.mfa.newChallenge(user, 'totp', remember, meta) };
    if (isStaff(user)) return { needs: 'enroll', challenge: this.mfa.newChallenge(user, 'enroll', remember, meta) };
    await this.mongo.users.updateOne({ _id: user.id as never }, { $set: { lastLoginAt: this.clock.now() } });
    await this.audit.record(user, 'login.success', user.id);
    return this.sessions.start({ ...user, lastLoginAt: this.clock.now() }, false, meta);
  }

  async logout(token: string | undefined): Promise<void> {
    await this.sessions.end(token);
  }

  async changePassword(user: User, current: unknown, next: unknown, currentToken?: string): Promise<void> {
    if (!user.passwordHash || !(await verifyPassword(String(current ?? ''), user.passwordHash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect');
    }
    const err = validatePassword(next, user.email);
    if (err) throw badRequest('WEAK_PASSWORD', err);
    const passwordHash = await hashPassword(next as string);
    await this.mongo.transaction(async () => {
      await this.mongo.users.updateOne({ _id: user.id as never }, { $set: { passwordHash } });
      await this.sessions.revokeAll(user.id, currentToken ?? null); // sign out everywhere else
      await this.audit.record(user, 'user.change_password', user.id);
    });
  }
}
