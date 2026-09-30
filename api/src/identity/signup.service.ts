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

// The name an account starts with, from the part of the email before the @ (Account can change it).
const defaultName = (email: string): string => email.split('@')[0].replace(/[._+-]+/g, ' ').trim().slice(0, 60) || 'New user';

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

  /** Appends a short random suffix until `company` is free. Real names collide innocently (two "Jordan Lee"s),
   * so an individual's org name is disambiguated instead of blocking the signup with a "name taken" error. */
  private async disambiguate(company: string): Promise<string> {
    let candidate = company;
    while (await this.orgs.nameTaken(candidate)) candidate = `${company} (${randomBytes(2).toString('hex')})`;
    return candidate;
  }

  async request(input: Record<string, unknown>, ip = 'unknown'): Promise<void> {
    if (input.website) return; // honeypot: a hidden field only bots fill in. Pretend it worked, do nothing.
    const email = String(input.email ?? '').trim().toLowerCase();
    this.rate.hit(`s:ip:${ip}`, 5);
    if (EMAIL_RE.test(email)) this.rate.hit(`s:em:${email}`, 3);

    if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest('INVALID_EMAIL', 'A valid work email address is required');
    const pwErr = validatePassword(input.password, email);
    if (pwErr) throw badRequest('WEAK_PASSWORD', pwErr);
    if (input.acceptTerms !== true) throw badRequest('TERMS_REQUIRED', 'You must accept the preview terms to continue');
    // Signup asks only for an email and password. Every account still gets an org (agent ownership, scoping and
    // mandates all key off orgId), so the name and the org's name start as placeholders taken from the email; the
    // owner sets the real ones in Account and Organization. A collision is disambiguated rather than refused,
    // since the placeholder is ours, not something the person chose. The check that matters is in verify(),
    // because a real org isn't created (and so can't collide) until then.
    const name = defaultName(email);
    const company = await this.disambiguate(`${name}'s organization`);
    const accountType = 'business';

    // An address that already has an account is told so, plainly: a person who forgot they signed up needs to know.
    // This does let anyone learn that an address is registered, so it leans on the per-address and per-source limits
    // above. A signup that is still waiting for its link is not an account yet and gets the usual reply.
    if (await this.users.findByEmail(email)) {
      await this.audit.record(null, 'signup.duplicate', email);
      throw new HttpError(409, 'EMAIL_EXISTS', 'An account with this email already exists. Sign in instead, or use a different email.');
    }
    const passwordHash = await hashPassword(input.password as string);
    const token = randomBytes(24).toString('base64url');
    const now = this.clock.now();
    const rec: PendingSignup = {
      email, name, company, accountType, passwordHash, verifyHash: sha256(token), createdAt: now, expires: now + SIGNUP_TTL_MS,
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
    if (await this.orgs.nameTaken(rec.company)) rec.company = await this.disambiguate(rec.company); // taken in the meantime
    return this.mongo.transaction(async () => {
      const org = await this.orgs.create(rec.company, null, rec.accountType);
      org.createdVia = 'signup';
      const { user } = await this.users.insert({ email: rec.email, name: rec.name, role: 'owner_admin', orgId: org.id, passwordHash: rec.passwordHash }, null);
      user.termsVersion = rec.termsVersion;
      user.termsAcceptedAt = rec.termsAcceptedAt;
      // This link was emailed to rec.email and only just clicked: that already proves the address, so there's
      // no separate email-verification step to make this account's owner go through afterwards.
      user.emailVerifiedAt = this.clock.now();
      org.createdBy = user.id;
      await this.mongo.users.save(user);
      await this.mongo.orgs.save(org);
      await this.audit.record(user, 'signup.verified', user.id, { orgId: org.id });
      return { email: user.email, orgName: org.name };
    });
  }
}
