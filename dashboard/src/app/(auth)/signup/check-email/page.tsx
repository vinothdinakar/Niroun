'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@bond/console-core/lib/api';
import { useFlow } from '@bond/console-core/lib/flow';
import { useHealth } from '@bond/console-core/lib/health';
import { useToast } from '@bond/console-core/lib/toast';
import type { OutboxMail } from '@bond/console-core/lib/types';

// The link inside a demo mailbox email points at this app; show it as an in-app link (path + fragment only).
function inAppLink(link: string | undefined): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    return u.pathname + u.hash;
  } catch {
    return null;
  }
}

export default function CheckEmailPage() {
  const router = useRouter();
  const flow = useFlow();
  const health = useHealth();
  const toast = useToast();
  const email = flow.signupEmail;
  const [mails, setMails] = useState<OutboxMail[] | null>(null);

  // A reload forgets the address: nothing to show, back to the form.
  useEffect(() => { if (!email) router.replace('/signup'); }, [email, router]);
  if (!email) return null;

  // Demo servers keep emails in memory instead of sending them. This shows the ones addressed to the person who just signed up.
  async function openMailbox() {
    try {
      const { emails } = await api<{ emails: OutboxMail[] }>('GET', '/v1/dev/outbox');
      setMails(emails.filter((m) => m.to === email.toLowerCase()).slice(0, 3));
    } catch (err) {
      toast(errorMessage(err), true);
    }
  }

  async function resend() {
    try {
      await api('POST', '/v1/signup/resend', { email });
      toast('If that address is waiting for verification, a new link is on its way.');
    } catch (err) {
      toast(errorMessage(err), true);
    }
  }

  return (
    <div>
      <h2>Check your email</h2>
      <p className="muted">If <b>{email}</b> can be registered, we&apos;ve sent a verification link. It works once and expires in 24 hours. Nothing is created until you use it.</p>
      {health?.devMailbox && (
        <div className="devbox">
          <strong>Demo mode</strong>
          <p className="muted small">No real email is sent here. This server keeps messages in a demo mailbox instead.</p>
          <button type="button" className="btn ghost sm" onClick={openMailbox}>Show my verification email</button>
          {mails && (mails.length ? mails.map((m, i) => {
            const href = inAppLink(m.link);
            return (
              <div className="mail" key={i}>
                <b>{m.subject}</b>
                <div className="muted">{m.text}</div>
                {href && <a className="btn primary sm" href={href}>Open verification link</a>}
              </div>
            );
          }) : <div className="mail muted">No email was sent to that address (none is sent if it was throttled).</div>)}
        </div>
      )}
      <p className="small">
        <button type="button" className="linklike" onClick={resend}>Resend the link</button>
        {' · '}<Link href="/login">Back to sign in</Link>
      </p>
    </div>
  );
}
