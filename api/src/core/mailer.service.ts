import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { BOND_OPTIONS, BondOptions } from '../config/options';

export interface MailMessage { to: string; subject: string; text: string; link?: string | null }
export interface SentMail extends MailMessage { at: number }

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 8000;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The only place email leaves the system. Everything else calls mailer.send({ to, subject, text, link }).
//
//   demo/tests  ('memory')   messages are kept in `outbox` (shown in the dashboard's demo mailbox); nothing is sent
//   RESEND_API_KEY set       ('resend')  messages are sent through Resend (https://resend.com)
//   otherwise   ('console')  messages are printed (local development)
//
// Verification and invite links are credentials: Resend is called over TLS only, and message bodies are never logged.
// A failed send is logged (recipient and status only) but does not throw: callers such as signup must answer the same
// way whether or not the address is known, so a delivery error can't be allowed to change the reply.
@Injectable()
export class MailerService {
  readonly mode: 'memory' | 'resend' | 'console';
  readonly outbox: SentMail[] = [];
  private readonly apiKey: string | undefined;
  private readonly from: string;

  constructor(@Inject(BOND_OPTIONS) options: BondOptions) {
    this.apiKey = options.resendApiKey;
    this.from = options.mailFrom;
    this.mode = options.devMailbox ? 'memory' : this.apiKey ? 'resend' : 'console';
  }

  async send(message: MailMessage): Promise<void> {
    const { to, subject, text, link = null } = message;
    if (this.mode === 'memory') {
      this.outbox.push({ to, subject, text, link, at: Date.now() });
      if (this.outbox.length > 50) this.outbox.shift();
    } else if (this.mode === 'resend') {
      await this.sendViaResend(message);
    } else {
      console.log(`[mail] to=${to} subject="${subject}"${link ? `\n       ${link}` : ''}`);
    }
  }

  private async sendViaResend({ to, subject, text, link = null }: MailMessage): Promise<void> {
    const body = {
      from: this.from,
      to: [to],
      subject,
      text: link ? `${text}\n\n${link}` : text,
      html: `<p>${escapeHtml(text)}</p>${link ? `<p><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>` : ''}`,
    };
    const idempotencyKey = randomUUID(); // reused across the retry so a timed-out first attempt can't double-send
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
        });
        if (res.ok) return;
        if (res.status < 500 && res.status !== 429) {
          console.error(`[mail] Resend rejected the message to=${to} status=${res.status}`);
          return;
        }
        if (attempt === 2) console.error(`[mail] Resend failed to=${to} status=${res.status}`);
      } catch (e) {
        if (attempt === 2) console.error(`[mail] Resend unreachable to=${to}: ${e instanceof Error ? e.name : 'error'}`);
      }
    }
  }
}
