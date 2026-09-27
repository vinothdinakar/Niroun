import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { Access, ClientIp } from '../common/decorators';
import { HttpError } from '../common/http-error';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { SignupService } from './signup.service';

type Json = Record<string, unknown>;

// Self-serve signup for a company that owns agents. The responses never reveal whether an email already has an account.
@Controller('v1/signup')
export class SignupController {
  constructor(private readonly signup: SignupService, @Inject(BOND_OPTIONS) private readonly options: BondOptions) {}

  private requireOpen(): void {
    if (this.options.signup !== 'open') {
      throw new HttpError(403, 'SIGNUP_CLOSED', 'Sign-up is by invitation only right now. Join the waitlist to request access.');
    }
  }

  @Post()
  @Access('public')
  @HttpCode(202)
  async request(@Body() body: Json, @ClientIp() ip: string): Promise<Json> {
    this.requireOpen();
    await this.signup.request(body, ip);
    return { ok: true, message: 'If that address can be registered, a verification link is on its way.' };
  }

  @Post('resend')
  @Access('public')
  @HttpCode(202)
  async resend(@Body() body: Json, @ClientIp() ip: string): Promise<Json> {
    this.requireOpen();
    await this.signup.resend(body.email, ip);
    return { ok: true, message: 'If that address is waiting for verification, a new link is on its way.' };
  }

  @Post('verify')
  @Access('public')
  @HttpCode(200)
  verify(@Body() body: Json): Promise<{ email: string; orgName: string }> {
    this.requireOpen();
    return this.signup.verify(body.token);
  }
}
