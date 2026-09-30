'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { NO_DISPLAY_PREFS, ROLE_LABEL, describeUserAgent, formatDateTime, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { DisplayPrefs, Me, SessionRow } from '../lib/types';
import { RecoveryDialog } from './account-dialogs';
import { PasswordInput } from './ui';
import { useLoaderShim } from './use-loader-shim';

const initials = (name: string): string =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';

const SECTIONS = [
  { id: 'profile', label: 'Profile' },
  { id: 'password', label: 'Password' },
  { id: 'two-step', label: 'Two-step verification' },
  { id: 'sessions', label: 'Active sessions' },
  { id: 'preferences', label: 'User preferences' },
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
          {active === 'sessions' && <SessionsSection />}
          {active === 'preferences' && <PreferencesSection me={me} />}
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
  const [legalFirstName, setLegalFirstName] = useState(u.legalFirstName ?? '');
  const [legalLastName, setLegalLastName] = useState(u.legalLastName ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = legalFirstName.trim() !== (u.legalFirstName ?? '') || legalLastName.trim() !== (u.legalLastName ?? '');

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const next = await api<Me>('PUT', '/v1/auth/me', { name: u.name, legalFirstName, legalLastName }) // the API still wants the name; it is no longer edited here;
      signedIn(next);
      setLegalFirstName(next.user.legalFirstName ?? '');
      setLegalLastName(next.user.legalLastName ?? '');
      toast('Profile saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="plain">Profile</h2>
      <form onSubmit={save}>
        <div className="two">
          <div>
            <label htmlFor="acct-legal-first">Legal first name</label>
            <input id="acct-legal-first" maxLength={80} placeholder="Optional" value={legalFirstName} onChange={(e) => setLegalFirstName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="acct-legal-last">Legal last name</label>
            <input id="acct-legal-last" maxLength={80} placeholder="Optional" value={legalLastName} onChange={(e) => setLegalLastName(e.target.value)} />
          </div>
        </div>
        <p className="muted small">Your legal name as it appears on official documents. Used for verification and compliance — not shown to your team.</p>
        <p className="form-error" role="alert">{error}</p>
        <div className="row-end">
          <button className="btn primary" type="submit" disabled={busy || !dirty}>Save</button>
        </div>
      </form>
      {u.role !== 'owner_admin' && <p className="muted small">{FIXED_NOTE[u.role]}</p>}

      <EmailSection me={me} />
      <PhoneSection me={me} />
    </>
  );
}

function EmailSection({ me }: { me: Me }) {
  const toast = useToast();
  const u = me.user;
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function sendLink() {
    setBusy(true);
    try {
      await api('POST', '/v1/auth/email/verify/send', {});
      setSent(true);
      toast(`Verification link sent to ${u.email}`);
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setting first">
      <div className="setting-label">
        <b>Email</b>
      </div>
      <div className="setting-body">
        <p className="setting-value">{u.email}</p>
        {!u.emailVerified && sent && <p className="muted small">Check your inbox — the link works once and expires in 24 hours.</p>}
      </div>
      <div className="setting-status">
        {u.emailVerified ? <span className="pill green">Verified</span> : <span className="pill amber">Not verified</span>}
        {!u.emailVerified && (
          <button className="btn ghost" type="button" disabled={busy} onClick={() => void sendLink()}>
            {busy ? 'Sending…' : sent ? 'Resend link' : 'Verify email'}
          </button>
        )}
      </div>
    </div>
  );
}

function PhoneSection({ me }: { me: Me }) {
  const { signedIn } = useSession();
  const toast = useToast();
  const u = me.user;
  const [phone, setPhone] = useState(u.phone ?? '');
  const [code, setCode] = useState('');
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dirty = phone.trim() !== (u.phone ?? '');

  const apply = (next: Me['user']) => signedIn({ ...me, user: next });

  async function savePhone(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<{ user: Me['user'] }>('PUT', '/v1/auth/phone', { phone: phone.trim() });
      apply(r.user);
      setPhone(r.user.phone ?? '');
      setAwaitingCode(false);
      toast('Phone number saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    setError('');
    setBusy(true);
    try {
      await api('POST', '/v1/auth/phone/verify/send', {});
      setAwaitingCode(true);
      toast(`Code sent to ${u.phone}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api<{ user: Me['user'] }>('POST', '/v1/auth/phone/verify/confirm', { code });
      apply(r.user);
      setAwaitingCode(false);
      setCode('');
      toast('Phone number verified');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setting">
      <div className="setting-label">
        <b>Phone</b>
      </div>
      <div className="setting-body">
        <form className="inline-field" onSubmit={dirty ? savePhone : (e) => e.preventDefault()}>
          <input
            aria-label="Phone number" placeholder="+14155550123" value={phone}
            onChange={(e) => { setPhone(e.target.value); setAwaitingCode(false); }}
          />
          {dirty ? (
            // Two "Save" buttons can be on screen at once (this one and the profile form's); name this
            // one after what it saves so assistive tech — and tests — can tell them apart.
            <button className="btn ghost sm" type="submit" aria-label="Save phone number" disabled={busy}>Save</button>
          ) : (
            u.phone && !u.phoneVerified && !awaitingCode && (
              <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void sendCode()}>Send code</button>
            )
          )}
        </form>
        {awaitingCode && (
          <form className="inline-field" onSubmit={confirmCode}>
            <input
              aria-label="Verification code" inputMode="numeric" maxLength={6} placeholder="6-digit code"
              value={code} onChange={(e) => setCode(e.target.value)}
            />
            <button className="btn primary sm" type="submit" disabled={busy || code.trim().length !== 6}>Confirm</button>
            <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void sendCode()}>Resend</button>
          </form>
        )}
        <p className="form-error" role="alert">{error}</p>
      </div>
      <div className="setting-status">
        {!u.phone ? <span className="pill gray">Not added</span> : u.phoneVerified ? <span className="pill green">Verified</span> : <span className="pill amber">Not verified</span>}
      </div>
    </div>
  );
}

// The change-password form sits right on the page (no popup).
function PasswordSection() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('POST', '/v1/auth/change-password', { current, next });
      setCurrent('');
      setNext('');
      toast('Password changed. Other devices were signed out.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="plain">Change password</h2>
      <p className="muted small">Use a long, unique password. Changing it signs you out of every other device.</p>
      <form onSubmit={submit}>
        <label htmlFor="pw-cur">Current password</label>
        <PasswordInput id="pw-cur" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <label htmlFor="pw-new">New password (12+ characters)</label>
        <PasswordInput id="pw-new" autoComplete="new-password" minLength={12} required value={next} onChange={(e) => setNext(e.target.value)} />
        <p className="form-error" role="alert">{error}</p>
        <p className="muted small">You&apos;ll stay signed in here; every other device is signed out.</p>
        <div className="row-end">
          <button className="btn primary" type="submit" disabled={busy || !current || next.length < 12}>Change password</button>
        </div>
      </form>
    </>
  );
}

// One card per setting, each saved the moment it changes. Dates across the console then follow these choices.
const DATE_FORMATS: { value: NonNullable<DisplayPrefs['dateFormat']>; label: string }[] = [
  { value: 'MDY', label: 'MM/DD/YYYY' }, { value: 'DMY', label: 'DD/MM/YYYY' }, { value: 'YMD', label: 'YYYY-MM-DD' },
];
const TIME_FORMATS: { value: NonNullable<DisplayPrefs['timeFormat']>; label: string }[] = [
  { value: '12h', label: '12-hour (AM/PM)' }, { value: '24h', label: '24-hour' },
];
const timeZones = (): string[] => {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  return supported ? supported('timeZone') : ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'];
};

function PreferencesSection({ me }: { me: Me }) {
  const { signedIn } = useSession();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const u = me.user;
  const prefs = { ...NO_DISPLAY_PREFS, ...u.preferences };
  const policy = u.sessionPolicy ?? { absoluteHours: 12, idleHours: 2 };
  const zones = useMemo(() => { const all = timeZones(); return prefs.timeZone && !all.includes(prefs.timeZone) ? [prefs.timeZone, ...all] : all; }, [prefs.timeZone]);
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const now = Date.now();
  const hours = (h: number) => `${h} hour${h === 1 ? '' : 's'}`;

  async function save(change: Partial<DisplayPrefs>) {
    setBusy(true);
    try {
      signedIn(await api<Me>('PUT', '/v1/auth/preferences', change));
      toast('Preference saved');
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="plain">User preferences</h2>
      <p className="muted small">How dates and times appear to you across the console. Only you see these choices.</p>

      <div className="pref-card">
        <div>
          <h3>My time zone</h3>
          <p className="muted small">When dates are displayed, show them in this time zone.</p>
        </div>
        <select aria-label="My time zone" disabled={busy} value={prefs.timeZone ?? ''} onChange={(e) => void save({ timeZone: e.target.value || null })}>
          <option value="">No preference ({browserZone})</option>
          {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      <div className="pref-card">
        <div>
          <h3>My date format</h3>
          <p className="muted small">When dates are displayed, show them in this format. Example: {formatDateTime(now, { ...prefs, dateFormat: prefs.dateFormat ?? 'MDY' }).split(',')[0]}</p>
        </div>
        <select aria-label="My date format" disabled={busy} value={prefs.dateFormat ?? ''} onChange={(e) => void save({ dateFormat: (e.target.value || null) as DisplayPrefs['dateFormat'] })}>
          <option value="">No preference</option>
          {DATE_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      <div className="pref-card">
        <div>
          <h3>My time format</h3>
          <p className="muted small">When times are displayed, show them in this format. Example: {when(now).split(', ').pop()}</p>
        </div>
        <select aria-label="My time format" disabled={busy} value={prefs.timeFormat ?? ''} onChange={(e) => void save({ timeFormat: (e.target.value || null) as DisplayPrefs['timeFormat'] })}>
          <option value="">No preference</option>
          {TIME_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      <div className="pref-card stacked">
        <h3>My session timeout</h3>
        <p className="muted small">Session timeouts are set by Bond and can&apos;t be changed here. A session ends when either limit is reached, whichever comes first.</p>
        <dl className="pref-facts">
          <div><dt>Absolute session timeout</dt><dd>{hours(policy.absoluteHours)}</dd></div>
          <div><dt>Idle session timeout</dt><dd>{hours(policy.idleHours)} without activity</dd></div>
        </dl>
      </div>
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

function SessionsSection() {
  const toast = useToast();
  const { data, error, reload } = useLoaderShim(() => api<{ sessions: SessionRow[] }>('GET', '/v1/auth/sessions'), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  async function endSession(s: SessionRow) {
    setBusy(s.id);
    try {
      await api('POST', `/v1/auth/sessions/${s.id}/revoke`, {});
      await reload();
      toast(s.current ? 'Signed out' : 'That device was signed out');
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setBusy(null);
    }
  }

  async function endOthers() {
    setConfirmAll(false);
    try {
      const r = await api<{ revoked: number }>('POST', '/v1/auth/sessions/revoke-all', {});
      await reload();
      toast(r.revoked ? `Signed out of ${r.revoked} other session${r.revoked === 1 ? '' : 's'}` : 'No other sessions were signed in');
    } catch (err) {
      toast(errorMessage(err), true);
    }
  }

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const others = data.sessions.filter((s) => !s.current);

  return (
    <>
      <h2 className="plain">Active sessions</h2>
      <p className="muted small">Every device currently signed in to your account. Changing your password signs out every device but this one.</p>
      {data.sessions.map((s, i) => (
        <div className={'setting' + (i === 0 ? ' first' : '')} key={s.id}>
          <div>
            <b>{describeUserAgent(s.userAgent)} {s.current && <span className="pill blue">This device</span>}</b>
            <p className="muted small">{s.ip} · last active {when(s.lastSeen)} · signed in {when(s.createdAt)}</p>
          </div>
          {!s.current && (
            // The nav also has a plain "Sign out" button (for this device); naming this one after the device
            // it ends keeps them distinct for assistive tech when several rows are listed.
            <button
              className="btn ghost sm" type="button" disabled={busy === s.id}
              aria-label={`Sign out ${describeUserAgent(s.userAgent)}`} onClick={() => void endSession(s)}
            >
              {busy === s.id ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </div>
      ))}
      {others.length > 0 && (
        <div className="row-start">
          {confirmAll ? (
            <>
              <span className="muted small">Sign out of {others.length} other session{others.length === 1 ? '' : 's'}?</span>
              <button className="btn danger sm" type="button" onClick={() => void endOthers()}>Yes, sign out</button>
              <button className="btn ghost sm" type="button" onClick={() => setConfirmAll(false)}>Cancel</button>
            </>
          ) : (
            <button className="btn ghost" type="button" onClick={() => setConfirmAll(true)}>Sign out everywhere else</button>
          )}
        </div>
      )}
    </>
  );
}
