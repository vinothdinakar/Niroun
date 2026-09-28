import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { RateLimitService } from '../core/rate-limit.service';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { HttpError, badRequest } from '../common/http-error';
import { TotpRecord, User } from '../storage/db.types';
import { sha256 } from '../domain/canonical';
import { newRecoveryCode, newSecret, normalizeRecovery, open, otpauthUri, seal, verifyTotp } from '../domain/totp';
import { SessionsService } from './sessions.service';

const CHALLENGE_TTL_MS = 5 * 60_000;
const CHALLENGE_MAX_ATTEMPTS = 5;
const ACCOUNT_MAX_FAILS = 5;
const RECOVERY_CODE_COUNT = 10;

type Purpose = 'totp' | 'enroll';
interface Challenge { userId: string; purpose: Purpose; exp: number; attempts: number; remember: boolean }

// Two-factor: authenticator-app codes (TOTP), one-time recovery codes, and first-time enrolment.
// A password alone never yields a session for anyone enrolled, or for any staff account.
//
// "Use once" rules are enforced by the database, not by a check-then-write: a code's time step and a recovery code
// are each consumed with one atomic update that only the first of two simultaneous requests can win.
@Injectable()
export class MfaService {
  /** Half-finished sign-ins waiting for a second factor (5 minutes, in memory). */
  private readonly challenges = new Map<string, Challenge>();

  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly rate: RateLimitService,
    private readonly sessions: SessionsService,
    @Inject(BOND_OPTIONS) private readonly options: BondOptions,
  ) {}

  /** Issues a short-lived, single-purpose token that proves the password step. It unlocks nothing but the next step. */
  newChallenge(user: User, purpose: Purpose, remember = true): string {
    const token = randomBytes(24).toString('base64url');
    const now = this.clock.now();
    for (const [h, c] of this.challenges) if (c.exp < now) this.challenges.delete(h);
    this.challenges.set(sha256(token), { userId: user.id, purpose, exp: now + CHALLENGE_TTL_MS, attempts: 0, remember });
    return token;
  }

  private async challenge(token: unknown, purpose: Purpose): Promise<{ h: string; c: Challenge; user: User }> {
    const h = sha256(String(token ?? ''));
    const c = this.challenges.get(h);
    const user = c ? await this.mongo.users.get(c.userId) : null;
    if (!c || c.exp < this.clock.now() || c.purpose !== purpose || !user || user.disabled) {
      throw new HttpError(401, 'INVALID_CHALLENGE', 'This sign-in step expired. Please start again.');
    }
    if (this.rate.isLocked(`t:${user.id}`, ACCOUNT_MAX_FAILS)) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Try again in 15 minutes.');
    }
    return { h, c, user };
  }

  // Count a wrong code: 5 per challenge (then it's destroyed and the password must be re-entered),
  // and 5 per account in 15 minutes across challenges (a 6-digit code can't be guessed by re-logging-in).
  // Returns the error to throw, after recording the failure (which must survive the throw).
  private async wrongCode(user: User, h: string, c: Challenge, what: string): Promise<HttpError> {
    c.attempts++;
    this.rate.recordFailure(`t:${user.id}`);
    await this.audit.record(user, `login.${what}_failed`, user.id, { attempts: c.attempts });
    if (c.attempts >= CHALLENGE_MAX_ATTEMPTS) this.challenges.delete(h);
    return new HttpError(401, 'INVALID_CODE', 'That code is incorrect.');
  }

  private secretOf(rec: { secretEnc: string }): string {
    return open(this.options.encryptionKey, rec.secretEnc);
  }

  /** Step 2 of sign-in for enrolled accounts: an authenticator code, or a one-time recovery code. */
  async verifyLogin(challengeToken: unknown, code: unknown): Promise<{ token: string; user: User; usedRecovery: boolean; recoveryCodesLeft: number; remember: boolean }> {
    const { h, c, user } = await this.challenge(challengeToken, 'totp');
    const input = String(code ?? '').trim();
    const now = this.clock.now();
    const totp = user.totp as TotpRecord;
    let usedRecovery = false;
    let left = user.recovery.length;

    if (/^\d{6}$/.test(input.replace(/\s/g, ''))) {
      const step = verifyTotp(this.secretOf(totp), input, now, totp.lastStep);
      if (step === null) throw await this.wrongCode(user, h, c, '2fa');
      // burn the step so the same code can't be reused, even by a simultaneous request
      const won = await this.mongo.users.updateOne({ _id: user.id as never, 'totp.lastStep': totp.lastStep }, { $set: { 'totp.lastStep': step } });
      if (!won) throw await this.wrongCode(user, h, c, '2fa');
    } else {
      const hash = sha256(normalizeRecovery(input));
      const won = await this.mongo.users.updateOne({ _id: user.id as never, recovery: hash }, { $pull: { recovery: hash } });
      if (!won) throw await this.wrongCode(user, h, c, 'recovery');
      usedRecovery = true;
      left -= 1;
      await this.audit.record(user, '2fa.recovery_used', user.id, { left });
    }
    this.challenges.delete(h);
    this.rate.clear(`t:${user.id}`);
    await this.mongo.users.updateOne({ _id: user.id as never }, { $set: { lastLoginAt: now } });
    await this.audit.record(user, 'login.success', user.id, { mfa: usedRecovery ? 'recovery' : 'totp' });
    // reload: the atomic updates above changed the stored user, and the response must describe the current one
    return { ...(await this.sessions.start(await this.current(user), true)), usedRecovery, recoveryCodesLeft: left, remember: c.remember };
  }

  /** Enrolment step 1: generate a secret to put into an authenticator app. Nothing is active until step 2 proves it works. */
  async beginEnrollment(challengeToken: unknown): Promise<{ secret: string; otpauthUri: string; account: string; issuer: string }> {
    const { user } = await this.challenge(challengeToken, 'enroll');
    if (user.totp?.enabledAt) throw new HttpError(409, 'ALREADY_ENROLLED', 'Two-factor is already set up for this account');
    const secret = newSecret();
    await this.mongo.users.updateOne({ _id: user.id as never }, { $set: { totpPending: { secretEnc: seal(this.options.encryptionKey, secret) } } });
    return { secret, otpauthUri: otpauthUri(secret, user.email), account: user.email, issuer: 'Bond' };
  }

  /** Enrolment step 2: the person types a code from their app. Only now is 2FA switched on; recovery codes are shown once. */
  async confirmEnrollment(challengeToken: unknown, code: unknown): Promise<{ token: string; user: User; recoveryCodes: string[]; remember: boolean }> {
    const { h, c, user } = await this.challenge(challengeToken, 'enroll');
    if (!user.totpPending) throw badRequest('NOT_STARTED', 'Start two-factor setup first');
    const step = verifyTotp(this.secretOf(user.totpPending), code, this.clock.now());
    if (step === null) throw await this.wrongCode(user, h, c, '2fa_enroll');

    const { codes, hashes } = this.freshRecoveryCodes();
    const now = this.clock.now();
    const won = await this.mongo.users.updateOne(
      { _id: user.id as never, 'totpPending.secretEnc': user.totpPending.secretEnc },
      { $set: { totp: { secretEnc: user.totpPending.secretEnc, enabledAt: now, lastStep: step }, totpPending: null, recovery: hashes, lastLoginAt: now } },
    );
    if (!won) throw badRequest('NOT_STARTED', 'Start two-factor setup first');
    this.challenges.delete(h);
    this.rate.clear(`t:${user.id}`);
    await this.audit.record(user, '2fa.enrolled', user.id);
    await this.audit.record(user, 'login.success', user.id, { mfa: 'enrolled' });
    return { ...(await this.sessions.start(await this.current(user), true)), recoveryCodes: codes, remember: c.remember };
  }

  /** The stored user as it is now (after this request's atomic updates). */
  private async current(user: User): Promise<User> {
    return (await this.mongo.users.get(user.id)) ?? user;
  }

  private freshRecoveryCodes(): { codes: string[]; hashes: string[] } {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
    return { codes, hashes: codes.map((x) => sha256(normalizeRecovery(x))) };
  }

  /** Replace all recovery codes. Needs a live authenticator code, so a stolen session alone can't do it. */
  async regenerateRecovery(user: User, code: unknown): Promise<string[]> {
    if (!user.totp?.enabledAt) throw badRequest('NOT_ENROLLED', 'Two-factor is not set up for this account');
    if (this.rate.isLocked(`t:${user.id}`, ACCOUNT_MAX_FAILS)) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Try again in 15 minutes.');
    }
    const step = verifyTotp(this.secretOf(user.totp), code, this.clock.now(), user.totp.lastStep);
    const { codes, hashes } = this.freshRecoveryCodes();
    const won = step === null ? 0 : await this.mongo.users.updateOne(
      { _id: user.id as never, 'totp.lastStep': user.totp.lastStep },
      { $set: { 'totp.lastStep': step, recovery: hashes } },
    );
    if (!won) {
      this.rate.recordFailure(`t:${user.id}`);
      throw new HttpError(401, 'INVALID_CODE', 'That code is incorrect.');
    }
    await this.audit.record(user, '2fa.recovery_regenerated', user.id);
    return codes;
  }
}
