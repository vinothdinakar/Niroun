'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { ROLE_LABEL, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Me } from '../lib/types';
import { PasswordDialog, RecoveryDialog } from './account-dialogs';

const initials = (name: string): string =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'password', label: 'Password' },
  { id: 'two-step', label: 'Two-step verification' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

// The signed-in person's own account: who they are, and how they sign in. (The organization is a separate page.)
// A menu on the left picks the section; the address (#password, #two-step) opens straight to one.
export function AccountView() {
  const { me } = useSession();
  return me ? <Account me={me} /> : null;
}

function Account({ me }: { me: Me }) {
  const { signOut } = useSession();
  const [active, setActive] = useState<SectionId>('profile');
  const u = me.user;

  useEffect(() => {
    const fromHash = () => {
      const id = window.location.hash.slice(1);
      if (SECTIONS.some((s) => s.id === id)) setActive(id as SectionId);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  const pick = (id: SectionId) => {
    setActive(id);
    window.history.replaceState(null, '', id === 'profile' ? window.location.pathname : `#${id}`);
  };

  return (
    <div className="account">
      <section className="panel acct-hero">
        <div className="avatar" aria-hidden="true">{initials(u.name)}</div>
        <div className="acct-id">
          <h2>{u.name}</h2>
          <p className="muted">{u.email}</p>
          <div className="acct-tags">
            <span className="pill blue">{ROLE_LABEL[u.role]}</span>
            {u.orgName && <span className="pill gray">{u.orgName}</span>}
          </div>
        </div>
        <dl className="acct-meta">
          <div><dt>Member since</dt><dd>{when(u.createdAt)}</dd></div>
          <div><dt>Last sign-in</dt><dd>{when(u.lastLoginAt)}</dd></div>
        </dl>
      </section>

      <div className="acct-layout">
        <nav className="acct-menu" aria-label="Account settings">
          <div role="tablist" aria-orientation="vertical">
            {SECTIONS.map((s) => (
              <button
                key={s.id} type="button" role="tab" id={`acct-tab-${s.id}`} aria-selected={active === s.id}
                aria-controls="acct-section" onClick={() => pick(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" className="acct-signout" onClick={() => void signOut()}>Sign out</button>
        </nav>
        <section className="panel pad acct-section" id="acct-section" role="tabpanel" aria-labelledby={`acct-tab-${active}`}>
          {active === 'profile' && <ProfileSection me={me} />}
          {active === 'password' && <PasswordSection />}
          {active === 'two-step' && <TwoStepSection me={me} />}
        </section>
      </div>
    </div>
  );
}

const FIXED_NOTE: Record<Me['user']['role'], string> = {
  owner_admin: 'Your email and role are fixed for this account. Your organization\'s details are on the Organization page.',
  owner_viewer: 'Your email, role and organization (shown above) are set by your organization\'s admins. Ask one of them to change them.',
  admin: 'Your email and role are managed by another staff admin.',
  reviewer: 'Your email and role are managed by a staff admin.',
};

function ProfileSection({ me }: { me: Me }) {
  const { signedIn } = useSession();
  const toast = useToast();
  const u = me.user;
  const [name, setName] = useState(u.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const next = await api<Me>('PUT', '/v1/auth/me', { name });
      signedIn(next);
      setName(next.user.name);
      toast('Name saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="plain">Profile</h2>
      <p className="muted small">How your name appears to your team.</p>
      <form onSubmit={save}>
        <label htmlFor="acct-name">Name</label>
        <div className="inline-field">
          <input id="acct-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn primary" type="submit" disabled={busy || !name.trim() || name.trim() === u.name}>Save</button>
        </div>
        <p className="form-error" role="alert">{error}</p>
      </form>
      <p className="muted small">{FIXED_NOTE[u.role]}</p>
    </>
  );
}

function PasswordSection() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <h2 className="plain">Password</h2>
      <p className="muted small">Use a long, unique password. Changing it signs you out of every other device.</p>
      <div className="row-start">
        <button className="btn ghost" type="button" onClick={() => setOpen(true)}>Change password</button>
      </div>
      <PasswordDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function TwoStepSection({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const u = me.user;
  const state =
    u.mfa === 'enabled'
      ? { label: 'On', color: 'green', note: 'Signing in asks for a code from your authenticator app.' }
      : u.mfa === 'required'
        ? { label: 'Required', color: 'amber', note: 'You will set this up the next time you sign in.' }
        : { label: 'Off', color: 'gray', note: 'Not turned on for this account.' };
  const left = u.recoveryCodesLeft ?? 0;

  return (
    <>
      <h2 className="plain">Two-step verification</h2>
      <div className="setting first">
        <div>
          <b>Status</b>
          <p className="muted small">{state.note}</p>
        </div>
        <span className={`pill ${state.color}`}>{state.label}</span>
      </div>
      {u.mfa === 'enabled' && (
        <div className="setting">
          <div>
            <b>Recovery codes</b>
            <p className={left <= 2 ? 'small warn' : 'muted small'}>
              {left} left{left <= 2 ? ' — generate a new set soon' : ''}. Each works once if you lose your authenticator.
            </p>
          </div>
          <button className="btn ghost" type="button" onClick={() => setOpen(true)}>Generate new codes</button>
        </div>
      )}
      <RecoveryDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
