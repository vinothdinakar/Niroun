import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { MailerService } from '../core/mailer.service';
import { RateLimitService } from '../core/rate-limit.service';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { HttpError, badRequest } from '../common/http-error';
import { PendingSignup } from '../storage/db.types';
import { sha256 } from '../domain/canonical';
import { hashPassword, validatePassword } from '../domain/password';
import { EMAIL_RE } from './identity.types';
import { OrgsService } from './orgs.service';
import { UsersService } from './users.service';

const SIGNUP_TTL_MS = 24 * 3_600_000;
// Placeholder wording (see the sign-up form). Have counsel replace it, and bump this, before real customers sign up.
export const TERMS_VERSION = 'preview-1';

// Self-serve signup for a company that owns agents.
// Nothing is created until the emailed link is used: a stranger can't claim a company name, and
// can't create an account for an email address they don't control.
// A pending signup is one row keyed by the email; `gcAt` lets MongoDB tidy up abandoned ones.
@Injectable()
export class SignupService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly mailer: MailerService,
    private readonly rate: RateLimitService,
    private readonly orgs: OrgsService,
    private readonly users: UsersService,
    @Inject(BOND_OPTIONS) private readonly options: BondOptions,
  ) {}

  private get col() {
    return this.mongo.col('signups');
  }

  /** The dashboard's URL for links in emails. Configured, never taken from the request's Host header. */
  private publicUrl(): string {
    return this.options.publicUrl ?? 'http://localhost';
  }

  private gcDate(): Date {
    return new Date(Date.now() + 3 * SIGNUP_TTL_MS);
  }

  async request(input: Record<string, unknown>, ip = 'unknown'): Promise<void> {
    if (input.website) return; // honeypot: a hidden field only bots fill in. Pretend it worked, do nothing.
    const email = String(input.email ?? '').trim().toLowerCase();
    this.rate.hit(`s:ip:${ip}`, 5);
    if (EMAIL_RE.test(email)) this.rate.hit(`s:em:${email}`, 3);

    if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest('INVALID_EMAIL', 'A valid work email address is required');
    const name = String(input.name ?? '').trim();
    if (!name || name.length > 80) throw badRequest('INVALID_NAME', 'Your name is required (80 characters at most)');
    const company = String(input.company ?? '').trim();
    if (company.length < 2 || company.length > 80) throw badRequest('INVALID_COMPANY', 'Company name must be 2-80 characters');
    const pwErr = validatePassword(input.password, email);
    if (pwErr) throw badRequest('WEAK_PASSWORD', pwErr);
    if (input.acceptTerms !== true) throw badRequest('TERMS_REQUIRED', 'You must accept the preview terms to continue');
    if (await this.orgs.nameTaken(company)) {
      throw new HttpError(409, 'ORG_EXISTS', `An organization named "${company}" is already registered. Ask its admin to invite you, or use a different name.`);
    }

    // Same work and the same reply whether or not the email is already known, so this endpoint can't be used to find out who has an account.
    const passwordHash = await hashPassword(input.password as string);
    if (await this.users.findByEmail(email)) {
      await this.audit.record(null, 'signup.duplicate', email);
      await this.mailer.send({
        to: email, subject: 'You already have a Bond account',
        text: 'Someone (hopefully you) tried to create a Bond account with this address, but one already exists. Sign in instead. If you forgot your password, ask your organization admin to reset it.',
        link: this.publicUrl(),
      });
      return;
    }
    const token = randomBytes(24).toString('base64url');
    const now = this.clock.now();
    const rec: PendingSignup = {
      email, name, company, passwordHash, verifyHash: sha256(token), createdAt: now, expires: now + SIGNUP_TTL_MS,
      termsVersion: TERMS_VERSION, termsAcceptedAt: now,
    };
    await this.col.replaceOne({ _id: email as never }, { ...rec, gcAt: this.gcDate() }, { upsert: true, ...this.mongo.tx });
    await this.audit.record(null, 'signup.requested', email, { company });
    await this.sendVerification(rec, token);
  }

  private sendVerification(rec: PendingSignup, token: string): Promise<void> {
    return this.mailer.send({
      to: rec.email, subject: 'Confirm your email for Bond',
      text: `Hi ${rec.name}, confirm your email to finish creating the Bond account for ${rec.company}. This link works once and expires in 24 hours. If this wasn't you, ignore this message and nothing will be created.`,
      // The token rides in the URL fragment: browsers never send it to a server or put it in a Referer or log.
      link: `${this.publicUrl()}/verify#token=${token}`,
    });
  }

  async resend(emailInput: unknown, ip = 'unknown'): Promise<void> {
    const email = String(emailInput ?? '').trim().toLowerCase();
    this.rate.hit(`s:ip:${ip}`, 5);
    if (EMAIL_RE.test(email)) this.rate.hit(`s:em:${email}`, 3);
    const token = randomBytes(24).toString('base64url');
    // the previous link stops working: its hash is replaced
    const res = await this.col.findOneAndUpdate(
      { _id: email as never },
      { $set: { verifyHash: sha256(token), expires: this.clock.now() + SIGNUP_TTL_MS } },
      { returnDocument: 'after', ...this.mongo.tx },
    );
    if (!res) return; // same silent answer as when it exists
    await this.sendVerification(res as unknown as PendingSignup, token);
  }

  /** The link was clicked: create the company and its first admin. No session is issued; they sign in normally. */
  async verify(token: unknown): Promise<{ email: string; orgName: string }> {
    const h = sha256(String(token ?? ''));
    // Take the pending signup out atomically: single use, even if two clicks race or what follows fails.
    const rec = (await this.col.findOneAndDelete({ verifyHash: h }, this.mongo.tx)) as unknown as PendingSignup | null;
    if (!rec || rec.expires < this.clock.now()) throw new HttpError(400, 'INVALID_VERIFICATION', 'This verification link is invalid or has expired. Please sign up again.');
    if (await this.users.findByEmail(rec.email)) throw new HttpError(409, 'USER_EXISTS', 'An account with this email already exists. Try signing in.');
    if (await this.orgs.nameTaken(rec.company)) {
      throw new HttpError(409, 'ORG_EXISTS', `An organization named "${rec.company}" was registered in the meantime. Ask its admin to invite you.`);
    }
    return this.mongo.transaction(async () => {
      const org = await this.orgs.create(rec.company, null);
      org.createdVia = 'signup';
      const { user } = await this.users.insert({ email: rec.email, name: rec.name, role: 'owner_admin', orgId: org.id, passwordHash: rec.passwordHash }, null);
      user.termsVersion = rec.termsVersion;
      user.termsAcceptedAt = rec.termsAcceptedAt;
      org.createdBy = user.id;
      await this.mongo.users.save(user);
      await this.mongo.orgs.save(org);
      await this.audit.record(user, 'signup.verified', user.id, { orgId: org.id });
      return { email: user.email, orgName: org.name };
    });
  }
}
