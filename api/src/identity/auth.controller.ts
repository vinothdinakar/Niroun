import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Access, ClientIp, CurrentUser, SessionToken } from '../common/decorators';
import { SESSION_COOKIE, STAFF_SESSION_COOKIE, appHint, parseCookies, sessionCookie, sessionCookieName } from '../common/cookies';
import { HttpError } from '../common/http-error';
import { BondRequest } from '../common/request';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { User } from '../storage/db.types';
import { sha256 } from '../domain/canonical';
import { permissionsOf } from '../domain/roles';
import { AuthService } from './auth.service';
import { ContactVerificationService } from './contact-verification.service';
import { MfaService } from './mfa.service';
import { SESSION_MAX_MS, SessionMeta, SessionsService } from './sessions.service';
import { SignInStep, isSession } from './identity.types';
import { UsersService } from './users.service';

type Json = Record<string, unknown>;

// Sign-in, sign-out, and two-factor. A session cookie is issued only once every required step has passed;
// until then the caller holds just a short-lived, single-purpose challenge that unlocks nothing else.
@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly contact: ContactVerificationService,
    @Inject(BOND_OPTIONS) private readonly options: BondOptions,
  ) {}

  private cookie(res: Response, req: BondRequest, token: string, maxAgeSec: number, persistent = true): void {
    const name = sessionCookieName(appHint(req.headers['x-bond-app'] as string | undefined));
    res.setHeader('Set-Cookie', sessionCookie(name, token, maxAgeSec, this.options.cookieSecure, persistent));
  }

  /** Best-effort "what device/browser is this" for the active-sessions list — never trusted for anything security-sensitive. */
  private meta(req: BondRequest, ip: string): SessionMeta {
    const ua = req.headers['user-agent'];
    return { ip, userAgent: (Array.isArray(ua) ? ua[0] : ua) ?? null };
  }

  private async signedIn(res: Response, req: BondRequest, session: { token: string; user: User }, extra: Json = {}, remember = true): Promise<Json> {
    this.cookie(res, req, session.token, SESSION_MAX_MS / 1000, remember);
    return { user: await this.users.publicUser(session.user), permissions: permissionsOf(session.user.role), ...extra };
  }

  private async step(res: Response, req: BondRequest, s: SignInStep, remember = true): Promise<Json> {
    return isSession(s) ? this.signedIn(res, req, s, {}, remember) : { needs: s.needs, challenge: s.challenge };
  }

  @Post('login')
  @Access('public')
  @HttpCode(200)
  async login(@Body() body: Json, @ClientIp() ip: string, @Req() req: BondRequest, @Res({ passthrough: true }) res: Response): Promise<Json> {
    return this.step(res, req, await this.auth.login(body.email, body.password, ip, !!body.remember, this.meta(req, ip)), !!body.remember);
  }

  @Post('accept-invite')
  @Access('public')
  @HttpCode(200)
  async acceptInvite(@Body() body: Json, @ClientIp() ip: string, @Req() req: BondRequest, @Res({ passthrough: true }) res: Response): Promise<Json> {
    return this.step(res, req, await this.auth.acceptInvite(body.token, body.password, this.meta(req, ip)));
  }

  @Post('logout')
  @Access('public')
  @HttpCode(200)
  async logout(@Req() req: BondRequest, @Res({ passthrough: true }) res: Response): Promise<Json> {
    const name = sessionCookieName(appHint(req.headers['x-bond-app'] as string | undefined));
    await this.auth.logout(parseCookies(req.headers.cookie)[name]);
    // Clear both cookie names: harmless if only one was ever set, and safe if a browser somehow
    // picked up both (e.g. while testing both consoles on the same hostname).
    res.setHeader('Set-Cookie', [
      sessionCookie(SESSION_COOKIE, '', 0, this.options.cookieSecure),
      sessionCookie(STAFF_SESSION_COOKIE, '', 0, this.options.cookieSecure),
    ]);
    return { ok: true };
  }

  @Get('me')
  @Access('user')
  async me(@CurrentUser() user: User): Promise<Json> {
    return { user: await this.users.publicUser(user), permissions: permissionsOf(user.role) };
  }

  @Put('me')
  @Access('user')
  async updateMe(@CurrentUser() user: User, @Body() body: Json): Promise<Json> {
    return { user: await this.users.updateProfile(user, body), permissions: permissionsOf(user.role) };
  }

  @Put('preferences')
  @Access('user')
  async updatePreferences(@CurrentUser() user: User, @Body() body: Json): Promise<Json> {
    return { user: await this.users.updatePreferences(user, body), permissions: permissionsOf(user.role) };
  }

  @Post('change-password')
  @Access('user')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: User, @SessionToken() token: string, @Body() body: Json): Promise<Json> {
    await this.auth.changePassword(user, body.current, body.next, token);
    return { ok: true };
  }

  // ---- active sessions ----
  @Get('sessions')
  @Access('user')
  async listSessions(@CurrentUser() user: User, @SessionToken() token: string): Promise<Json> {
    return { sessions: await this.sessions.list(user.id, token) };
  }

  @Post('sessions/:id/revoke')
  @Access('user')
  @HttpCode(200)
  async revokeSession(
    @CurrentUser() user: User, @SessionToken() token: string, @Param('id') id: string,
    @Req() req: BondRequest, @Res({ passthrough: true }) res: Response,
  ): Promise<Json> {
    const wasCurrent = token !== undefined && sha256(token) === id;
    if (!(await this.sessions.revoke(user.id, id))) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Unknown session');
    // Ending your own current session is the same as signing out: the cookie must go with it.
    if (wasCurrent) {
      const name = sessionCookieName(appHint(req.headers['x-bond-app'] as string | undefined));
      res.setHeader('Set-Cookie', sessionCookie(name, '', 0, this.options.cookieSecure));
    }
    return { ok: true };
  }

  @Post('sessions/revoke-all')
  @Access('user')
  @HttpCode(200)
  async revokeOtherSessions(@CurrentUser() user: User, @SessionToken() token: string): Promise<Json> {
    return { revoked: await this.sessions.revokeAll(user.id, token) };
  }

  // ---- contact verification (proving you hold the email/phone on file, not identity verification) ----
  @Post('email/verify/send')
  @Access('user')
  @HttpCode(200)
  async sendEmailVerification(@CurrentUser() user: User, @Req() req: BondRequest): Promise<Json> {
    await this.contact.sendEmailVerification(user, appHint(req.headers['x-bond-app'] as string | undefined));
    return { ok: true };
  }

  // Public: the link may be opened in a browser with no session (a different device, or none at all).
  // The one-time token itself is the proof, the same trust model as accepting an invite.
  @Post('email/verify/confirm')
  @Access('public')
  @HttpCode(200)
  async confirmEmailVerification(@Body() body: Json): Promise<Json> {
    return this.contact.confirmEmailVerification(body.token);
  }

  @Put('phone')
  @Access('user')
  @HttpCode(200)
  async setPhone(@CurrentUser() user: User, @Body() body: Json): Promise<Json> {
    return { user: await this.contact.setPhone(user, body.phone) };
  }

  @Post('phone/verify/send')
  @Access('user')
  @HttpCode(200)
  async sendPhoneVerification(@CurrentUser() user: User): Promise<Json> {
    await this.contact.sendPhoneCode(user);
    return { ok: true };
  }

  @Post('phone/verify/confirm')
  @Access('user')
  @HttpCode(200)
  async confirmPhoneVerification(@CurrentUser() user: User, @Body() body: Json): Promise<Json> {
    return { user: await this.contact.confirmPhoneCode(user, body.code) };
  }

  // ---- two-factor ----
  @Post('2fa/verify')
  @Access('public')
  @HttpCode(200)
  async verify(@Body() body: Json, @Req() req: BondRequest, @Res({ passthrough: true }) res: Response): Promise<Json> {
    const r = await this.mfa.verifyLogin(body.challenge, body.code);
    return this.signedIn(res, req, r, { usedRecoveryCode: r.usedRecovery, recoveryCodesLeft: r.recoveryCodesLeft }, r.remember);
  }

  @Post('2fa/begin')
  @Access('public')
  @HttpCode(200)
  async begin(@Body() body: Json): Promise<Json> {
    return { ...(await this.mfa.beginEnrollment(body.challenge)) };
  }

  @Post('2fa/confirm')
  @Access('public')
  @HttpCode(200)
  async confirm(@Body() body: Json, @Req() req: BondRequest, @Res({ passthrough: true }) res: Response): Promise<Json> {
    const r = await this.mfa.confirmEnrollment(body.challenge, body.code);
    return this.signedIn(res, req, r, { recoveryCodes: r.recoveryCodes }, r.remember);
  }

  @Post('2fa/recovery-codes')
  @Access('user')
  @HttpCode(200)
  async recoveryCodes(@CurrentUser() user: User, @Body() body: Json): Promise<Json> {
    return { recoveryCodes: await this.mfa.regenerateRecovery(user, body.code) };
  }
}
