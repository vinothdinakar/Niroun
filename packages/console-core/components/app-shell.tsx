'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useFlow } from '../lib/flow';
import { ROLE_LABEL } from '../lib/format';
import { useSession } from '../lib/session';
import type { Permission } from '../lib/types';
import { PasswordDialog, RecoveryDialog } from './account-dialogs';
import { AgentDrawerProvider } from './agent-drawer';

export interface NavTab { href: string; label: string; needs?: Permission }

// The overview page reports whether its live refresh is working; the header shows it as a dot.
const LiveContext = createContext<(on: boolean) => void>(() => undefined);
export const useSetLive = () => useContext(LiveContext);

/**
 * Everything for a signed-in person: the header, navigation, account dialogs and the agent drawer.
 * `tabs` is the app's own nav (the customer dashboard and the staff console pass different lists).
 * `badge`, if given, is a small label next to the logo (the staff console uses this so nobody mistakes
 * which app a tab is, since the two now have separate origins and separate sessions).
 * Signed-out visitors are sent to /login. (The API decides what data anyone may see; this only avoids showing a shell.)
 */
export function AppShell({ tabs, badge, children }: { tabs: NavTab[]; badge?: string; children: ReactNode }) {
  const { status, me, has, signOut } = useSession();
  const { reset } = useFlow();
  const router = useRouter();
  const pathname = usePathname();
  const [live, setLive] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);

  useEffect(() => { if (status === 'out') router.replace('/login'); }, [status, router]);
  useEffect(() => { if (status === 'in') reset(); }, [status, reset]); // sign-in leftovers (challenge, codes) don't outlive sign-in

  if (status !== 'in' || !me) return <div className="loading" role="status">Loading…</div>;
  const u = me.user;

  return (
    <LiveContext.Provider value={setLive}>
      <AgentDrawerProvider>
        <a className="skip" href="#main">Skip to content</a>
        <header className="top">
          <div className="brand-row">
            <h1 className="logo">Bond<span>.</span></h1>
            {badge && <span className="badge-staff">{badge}</span>}
            <nav className="tabs" aria-label="Sections">
              {tabs.filter((t) => !t.needs || has(t.needs)).map((t) => (
                <Link key={t.href} href={t.href} aria-current={(t.href === '/' ? pathname === '/' : pathname.startsWith(t.href)) ? 'page' : undefined}>{t.label}</Link>
              ))}
            </nav>
          </div>
          <div className="who">
            <span className={'dot' + (live ? ' on' : '')} title={live ? 'Live' : 'Not live'} />
            <span><b>{u.name}</b> <span className="role">{ROLE_LABEL[u.role]}</span>{u.orgName ? ` · ${u.orgName}` : ''}</span>
            {u.mfa === 'enabled' && <button className="btn ghost sm" onClick={() => setRecoveryOpen(true)}>Recovery codes</button>}
            <button className="btn ghost sm" onClick={() => setPasswordOpen(true)}>Password</button>
            <button className="btn ghost sm" onClick={() => signOut()}>Sign out</button>
          </div>
        </header>
        <main id="main">{children}</main>
        <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
        <RecoveryDialog open={recoveryOpen} onClose={() => setRecoveryOpen(false)} />
      </AgentDrawerProvider>
    </LiveContext.Provider>
  );
}
