import { Inject, Injectable } from '@nestjs/common';
import { BOND_OPTIONS, BondOptions } from '../config/options';

export interface SmsMessage { to: string; text: string }
export interface SentSms extends SmsMessage { at: number }

// The only place a text message leaves the system. Everything else calls sms.send({ to, text }).
// Mirrors MailerService exactly (see there for the modes and the note on going live).
//
//   demo/tests  ('memory')   messages are kept in `outbox` (shown in the dashboard's demo mailbox); nothing is sent
//   otherwise   ('console')  messages are printed (local development)
//
// To go live, add a provider (Twilio, SNS, ...) inside send(); no other file changes. A verification code
// is a credential: a real provider must be TLS-only, and never log message bodies.
@Injectable()
export class SmsService {
  readonly mode: 'memory' | 'console';
  readonly outbox: SentSms[] = [];

  constructor(@Inject(BOND_OPTIONS) options: BondOptions) {
    this.mode = options.devMailbox ? 'memory' : 'console';
  }

  async send({ to, text }: SmsMessage): Promise<void> {
    const message: SentSms = { to, text, at: Date.now() };
    if (this.mode === 'memory') {
      this.outbox.push(message);
      if (this.outbox.length > 50) this.outbox.shift();
    } else {
      console.log(`[sms] to=${to} text="${text}"`);
    }
  }
}
