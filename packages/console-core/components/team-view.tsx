'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { ROLE_LABEL, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useCopy, useToast } from '../lib/toast';
import type { InviteResult, Org, PersonRow, Role } from '../lib/types';
import { useLoaderShim } from './use-loader-shim';
import { FormPanel, NotAllowed, Panel } from './ui';

export function TeamView() {
  const { has } = useSession();
  return has('team_manage') ? <Team /> : <NotAllowed />;
}

function Team() {
  const { me, isStaff } = useSession();
  const toast = useToast();
  const copy = useCopy();
  const { data, error, reload } = useLoaderShim(async () => {
    const [u, o] = await Promise.all([api<{ users: PersonRow[] }>('GET', '/v1/console/users'), api<{ orgs: Org[] }>('GET', '/v1/console/orgs')]);
    return { users: u.users, orgs: o.orgs };
  }, []);
  const roles: Role[] = isStaff ? ['admin', 'reviewer', 'owner_admin', 'owner_viewer'] : ['owner_admin', 'owner_viewer'];
  const [form, setForm] = useState({ email: '', name: '', role: roles[0], orgId: '' });
  const [formError, setFormError] = useState('');
  const [link, setLink] = useState<{ heading: string; email: string; url: string; expires: number | null } | null>(null);
  const [confirmReset, setConfirmReset] = useState<string | null>(null);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const needsOrg = isStaff && (form.role === 'owner_admin' || form.role === 'owner_viewer');
  const orgId = form.orgId || data.orgs[0]?.id || '';

  // The one-time link is built here from this app's own address, so a staff invite links to the staff
  // console and a customer invite links to the dashboard, whichever one this page is running in.
  const showLink = (r: InviteResult, heading: string) =>
    setLink({ heading, email: r.user.email, url: `${window.location.origin}/invite#token=${r.inviteToken}`, expires: r.inviteExpires });

  async function invite(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    try {
      const r = await api<InviteResult>('POST', '/v1/console/users', {
        email: form.email, name: form.name, role: form.role, orgId: isStaff ? orgId : undefined,
      });
      showLink(r, 'Invitation created');
      setForm({ email: '', name: '', role: roles[0], orgId: '' });
      await reload();
    } catch (err) {
      setFormError(errorMessage(err));
    }
  }

  async function toggleDisabled(p: PersonRow) {
    try {
      await api('POST', `/v1/console/users/${p.id}/${p.disabled ? 'enable' : 'disable'}`, {});
      await reload();
    } catch (err) { toast(errorMessage(err), true); }
  }

  async function reset(p: PersonRow) {
    setConfirmReset(null);
    try {
      showLink(await api<InviteResult>('POST', `/v1/console/users/${p.id}/reset`, {}), 'Reset link created');
      await reload();
    } catch (err) { toast(errorMessage(err), true); }
  }

  return (
    <div className="tab">
      <FormPanel title="Invite someone">
        <p className="muted">They receive a one-time link and choose their own password. Nobody is ever given a password.</p>
        <form className="inline-form" onSubmit={invite}>
          <div><label htmlFor="tm-email">Email</label><input id="tm-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label htmlFor="tm-name">Name</label><input id="tm-name" maxLength={80} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div>
            <label htmlFor="tm-role">Role</label>
            <select id="tm-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          {needsOrg && (
            <div>
              <label htmlFor="tm-org">Organization</label>
              <select id="tm-org" value={orgId} onChange={(e) => setForm({ ...form, orgId: e.target.value })}>
                {data.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <div className="end"><button className="btn primary" type="submit">Create invite</button></div>
        </form>
        <p className="form-error" role="alert">{formError}</p>
        {link && (
          <div className="secret">
            <strong>{link.heading}</strong>
            <p className="muted small">Send this link to {link.email}. It works once and expires {when(link.expires)}. It is shown only now.</p>
            <code>{link.url}</code>
            <button className="btn ghost sm" onClick={() => copy(link.url)}>Copy link</button>
          </div>
        )}
      </FormPanel>

      <Panel title="People">
        <table>
          <thead><tr><th>Person</th><th>Role</th><th>Organization</th><th>Status</th><th>2FA</th><th>Last sign-in</th><th></th></tr></thead>
          <tbody>
            {data.users.map((x) => {
              const self = x.id === me?.user.id;
              return (
                <tr key={x.id}>
                  <td><div className="name">{x.name}{self && <> <span className="mine">YOU</span></>}</div><div className="owner">{x.email}</div></td>
                  <td>{ROLE_LABEL[x.role]}</td>
                  <td className="muted">{x.orgName || 'Bond'}</td>
                  <td>{x.disabled ? <span className="pill red">Disabled</span> : x.pendingInvite ? <span className="pill amber">Invited</span> : <span className="pill green">Active</span>}</td>
                  <td>{x.mfa === 'enabled' ? <span className="pill green">On</span> : x.mfa === 'required' ? <span className="pill amber">Required</span> : <span className="muted">Off</span>}</td>
                  <td className="muted">{when(x.lastLoginAt)}</td>
                  <td>
                    {!self && (confirmReset === x.id ? (
                      <>
                        <span className="muted small">Sign them out everywhere, invalidate their password, issue a new setup link?</span>{' '}
                        <button className="btn danger sm" onClick={() => reset(x)}>Yes, reset</button>{' '}
                        <button className="btn ghost sm" onClick={() => setConfirmReset(null)}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button className="btn ghost sm" onClick={() => toggleDisabled(x)}>{x.disabled ? 'Enable' : 'Disable'}</button>{' '}
                        <button className="btn ghost sm" onClick={() => setConfirmReset(x.id)}>Reset</button>
                      </>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
