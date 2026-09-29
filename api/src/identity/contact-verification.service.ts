import { Inject, Injectable } from '@nestjs/common';
import { randomBytes, randomInt } from 'node:crypto';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { MailerService } from '../core/mailer.service';
import { SmsService } from '../core/sms.service';
import { RateLimitService } from '../core/rate-limit.service';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { HttpError, badRequest } from '../common/http-error';
import { AppHint } from '../common/cookies';
import { User } from '../storage/db.types';
import { sha256 } from '../domain/canonical';
import { PublicUser } from './identity.types';
import { UsersService } from './users.service';

const EMAIL_VERIFY_TTL_MS = 24 * 3_600_000;
const PHONE_CODE_TTL_MS = 10 * 60_000;
const PHONE_CODE_MAX_FAILS = 5;
// Loose E.164-ish check (optional leading +, 8-15 digits): this is a self-service contact detail, not a
// billing address, so the bar is "plausible enough to text a code to", not full libphonenumber validation.
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

/** The 6-digit code as a zero-padded string, e.g. "042917". */
const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

// Self-service proof that the account holder actually controls the email and phone number on file. This is
// NOT identity verification (see verification-requests.service.ts for an organization's KYB/KYC) — just the
// same "can you read what we sent to that address" check most consumer apps run.
//
// Email re-uses the signup link pattern (a one-time, hashed, expiring token in the URL fragment); phone gets
// a short-lived numeric code instead, since there's no "click this link" for an SMS. Both live as a hash on
// the user document, the same way an invite or a TOTP-enrolment secret does until it is claimed.
@Injectable()
export class ContactVerificationService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly sms: SmsService,
    private readonly rate: RateLimitService,
    private readonly users: UsersService,
    @Inject(BOND_OPTIONS) private readonly options: BondOptions,
  ) {}

  /** Which console's own address to put in the link — never the request's Host header. Falls back to the
   * dashboard's URL for staff when a separate staff URL isn't configured (fine for a single-server setup). */
  private baseUrl(hint: AppHint): string {
    return (hint === 'staff' ? this.options.staffUrl : undefined) ?? this.options.publicUrl ?? 'http://localhost';
  }

  // ---------- email ----------
  async sendEmailVerification(user: User, hint: AppHint): Promise<void> {
    if (user.emailVerifiedAt) throw badRequest('ALREADY_VERIFIED', 'This email address is already verified');
    this.rate.hit(`ev:${user.id}`, 5, 3_600_000, 'TOO_MANY_REQUESTS', 'Too many requests. Try again in an hour.');
    const token = randomBytes(24).toString('base64url');
    const now = this.clock.now();
    await this.mongo.users.updateOne({ _id: user.id as never }, { $set: { emailVerifyHash: sha256(token), emailVerifyExpires: now + EMAIL_VERIFY_TTL_MS } });
    await this.mailer.send({
      to: user.email, subject: 'Verify your email for Bond',
      text: `Hi ${user.name}, confirm that you have access to this email address. This link works once and expires in 24 hours. If this wasn't you, ignore this message — nothing changes until it's clicked.`,
      // Rides in the URL fragment, like every other one-time token here: browsers never send it to a server or log it.
      link: `${this.baseUrl(hint)}/verify-email#token=${token}`,
    });
    await this.audit.record(user, 'user.email_verify_requested', user.id);
  }

  /** The link was clicked. No session is required (it may be opened in a different browser): the token alone,
   * hashed and single-use, is the proof — the same trust model as accepting an invite. */
  async confirmEmailVerification(token: unknown): Promise<{ email: string }> {
    const h = sha256(String(token ?? ''));
    const user = await this.mongo.users.findOne({ emailVerifyHash: h });
    const now = this.clock.now();
    if (!user || (user.emailVerifyExpires ?? 0) < now) {
      throw new HttpError(400, 'INVALID_VERIFICATION', 'This verification link is invalid or has expired. Request a new one from your account page.');
    }
    // Compare-and-set: if two clicks race (or a resent link's old copy is used), only the first wins.
    const won = await this.mongo.users.updateOne(
      { _id: user.id as never, emailVerifyHash: h },
      { $set: { emailVerifiedAt: now, emailVerifyHash: null, emailVerifyExpires: null } },
    );
    if (!won) throw new HttpError(400, 'INVALID_VERIFICATION', 'This verification link is invalid or has expired. Request a new one from your account page.');
    await this.audit.record(user, 'user.email_verified', user.id);
    return { email: user.email };
  }

  // ---------- phone ----------
  /** Sets (or changes) the phone number on file. Changing it always resets verification: whoever is texted
   * the code next is the one who has to prove they hold the (possibly new) number. */
  async setPhone(user: User, phoneInput: unknown): Promise<PublicUser> {
    const raw = String(phoneInput ?? '').trim();
    if (!PHONE_RE.test(raw)) throw badRequest('INVALID_PHONE', 'Enter a phone number in international format, e.g. +14155550123');
    return this.mongo.transaction(async () => {
      const fresh = ((await this.mongo.users.get(user.id)) as User) ?? user;
      if (fresh.phone !== raw) {
        fresh.phone = raw;
        fresh.phoneVerifiedAt = null;
        fresh.phoneCodeHash = null;
        fresh.phoneCodeExpires = null;
      }
      await this.mongo.users.save(fresh);
      await this.audit.record(user, 'user.phone_update', user.id);
      return this.users.publicUser(fresh);
    });
  }

  async sendPhoneCode(user: User): Promise<void> {
    const fresh = ((await this.mongo.users.get(user.id)) as User) ?? user;
    if (!fresh.phone) throw badRequest('NO_PHONE', 'Add a phone number first');
    if (fresh.phoneVerifiedAt) throw badRequest('ALREADY_VERIFIED', 'This phone number is already verified');
    this.rate.hit(`pv:${user.id}`, 5, 3_600_000, 'TOO_MANY_REQUESTS', 'Too many requests. Try again in an hour.');
    const code = newCode();
    const now = this.clock.now();
    await this.mongo.users.updateOne({ _id: user.id as never }, { $set: { phoneCodeHash: sha256(code), phoneCodeExpires: now + PHONE_CODE_TTL_MS } });
    await this.sms.send({ to: fresh.phone, text: `${code} is your Bond verification code. It expires in 10 minutes.` });
    await this.audit.record(user, 'user.phone_verify_requested', user.id);
  }

  /** Unlike email, this always runs in the account's own session: a 6-digit code is guessable in far fewer
   * tries than a 24-hour link token, so it's worth the extra bar (and the per-account lockout below). */
  async confirmPhoneCode(user: User, codeInput: unknown): Promise<PublicUser> {
    if (this.rate.isLocked(`pvc:${user.id}`, PHONE_CODE_MAX_FAILS)) {
      throw new HttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Try again in 15 minutes.');
    }
    const fresh = ((await this.mongo.users.get(user.id)) as User) ?? user;
    const now = this.clock.now();
    if (!fresh.phoneCodeHash || (fresh.phoneCodeExpires ?? 0) < now) {
      throw new HttpError(400, 'INVALID_CODE', 'That code has expired. Request a new one.');
    }
    const code = String(codeInput ?? '').trim();
    if (sha256(code) !== fresh.phoneCodeHash) {
      this.rate.recordFailure(`pvc:${user.id}`);
      throw new HttpError(400, 'INVALID_CODE', 'That code is incorrect.');
    }
    this.rate.clear(`pvc:${user.id}`);
    await this.mongo.users.updateOne({ _id: user.id as never }, { $set: { phoneVerifiedAt: now, phoneCodeHash: null, phoneCodeExpires: null } });
    await this.audit.record(user, 'user.phone_verified', user.id);
    return this.users.publicUser({ ...fresh, phoneVerifiedAt: now, phoneCodeHash: null, phoneCodeExpires: null });
  }
}
