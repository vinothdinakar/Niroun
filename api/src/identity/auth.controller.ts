import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Access, ClientIp, CurrentUser, SessionToken } from '../common/decorators';
import { SESSION_COOKIE, STAFF_SESSION_COOKIE, appHint, parseCookies, sessionCookie, sessionCookieName } from '../common/cookies';
import { BondRequest } from '../common/request';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { User } from '../storage/db.types';
import { permissionsOf } from '../domain/roles';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { SESSION_MAX_MS } from './sessions.service';
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
    @Inject(BOND_OPTIONS) private readonly options: BondOptions,
  ) {}

  private cookie(res: Response, req: BondRequest, token: string, maxAgeSec: number, persistent = true): void {
    const name = sessionCookieName(appHint(req.headers['x-bond-app'] as string | undefined));
    res.setHeader('Set-Cookie', sessionCookie(name, token, maxAgeSec, this.options.cookieSecure, persistent));
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
    return this.step(res, req, await this.auth.login(body.email, body.password, ip, !!body.remember), !!body.remember);
  }

  @Post('accept-invite')
  @Access('public')
  @HttpCode(200)
  async acceptInvite(@Body() body: Json, @Req() req: BondRequest, @Res({ passthrough: true }) res: Response): Promise<Json> {
    return this.step(res, req, await this.auth.acceptInvite(body.token, body.password));
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
    return { user: await this.users.rename(user, body.name), permissions: permissionsOf(user.role) };
  }

  @Post('change-password')
  @Access('user')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: User, @SessionToken() token: string, @Body() body: Json): Promise<Json> {
    await this.auth.changePassword(user, body.current, body.next, token);
    return { ok: true };
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
