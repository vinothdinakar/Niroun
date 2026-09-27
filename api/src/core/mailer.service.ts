import { Inject, Injectable } from '@nestjs/common';
import { BOND_OPTIONS, BondOptions } from '../config/options';

export interface MailMessage { to: string; subject: string; text: string; link?: string | null }
export interface SentMail extends MailMessage { at: number }

// The only place email leaves the system. Everything else calls mailer.send({ to, subject, text, link }).
//
//   demo/tests  ('memory')   messages are kept in `outbox` (shown in the dashboard's demo mailbox); nothing is sent
//   otherwise   ('console')  messages are printed (local development)
//
// To go live, add a provider (SES, Postmark, SMTP, ...) inside send(); no other file changes.
// Verification and invite links are credentials: a real provider must be TLS-only, and never log message bodies.
@Injectable()
export class MailerService {
  readonly mode: 'memory' | 'console';
  readonly outbox: SentMail[] = [];

  constructor(@Inject(BOND_OPTIONS) options: BondOptions) {
    this.mode = options.devMailbox ? 'memory' : 'console';
  }

  async send({ to, subject, text, link = null }: MailMessage): Promise<void> {
    const message: SentMail = { to, subject, text, link, at: Date.now() };
    if (this.mode === 'memory') {
      this.outbox.push(message);
      if (this.outbox.length > 50) this.outbox.shift();
    } else {
      console.log(`[mail] to=${to} subject="${subject}"${link ? `\n       ${link}` : ''}`);
    }
  }
}
