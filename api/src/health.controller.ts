import { Controller, Get, Inject } from '@nestjs/common';
import { Access } from './common/decorators';
import { HttpError } from './common/http-error';
import { BOND_OPTIONS, BondOptions } from './config/options';
import { MailerService, SentMail } from './core/mailer.service';
import { SentSms, SmsService } from './core/sms.service';

@Controller()
export class HealthController {
  constructor(
    private readonly mailer: MailerService,
    private readonly sms: SmsService,
    @Inject(BOND_OPTIONS) private readonly options: BondOptions,
  ) {}

  @Get()
  @Access('public')
  root() {
    return { name: 'Bond API', version: 'v1', health: '/v1/health', note: 'The dashboard is a separate app (see /dashboard).' };
  }

  @Get('v1/health')
  @Access('public')
  health() {
    return { ok: true, signup: this.options.signup, devMailbox: this.options.devMailbox };
  }

  /** Demo and tests only: the emails the system would have sent, newest first. Does not exist unless enabled. */
  @Get('v1/dev/outbox')
  @Access('public')
  outbox(): { emails: SentMail[] } {
    if (!this.options.devMailbox) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    return { emails: [...this.mailer.outbox].reverse() };
  }

  /** Same idea as the mail outbox, for phone verification codes. */
  @Get('v1/dev/sms-outbox')
  @Access('public')
  smsOutbox(): { texts: SentSms[] } {
    if (!this.options.devMailbox) throw new HttpError(404, 'NOT_FOUND', 'Not found');
    return { texts: [...this.sms.outbox].reverse() };
  }
}
