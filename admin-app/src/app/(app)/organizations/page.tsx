'use client';

import { FormPanel, NotAllowed, Panel } from '@bond/console-core/components/ui';
import { api } from '@bond/console-core/lib/api';
import { errorMessage } from '@bond/console-core/lib/api';
import { VERIFY, when } from '@bond/console-core/lib/format';
import { useLoader } from '@bond/console-core/lib/hooks';
import { useSession } from '@bond/console-core/lib/session';
import { useToast } from '@bond/console-core/lib/toast';
import type { Agent, Org, PersonRow } from '@bond/console-core/lib/types';
import { useState, type FormEvent } from 'react';

// Staff-only: customers never create or verify organizations, so this page doesn't exist in the dashboard app.
export default function OrganizationsPage() {
  const { has } = useSession();
  return has('orgs') ? <Organizations /> : <NotAllowed />;
}

function Organizations() {
  const toast = useToast();
  const { data, error, reload } = useLoader(async () => {
    const [o, u, ag] = await Promise.all([
      api<{ orgs: Org[] }>('GET', '/v1/console/orgs'),
      api<{ users: PersonRow[] }>('GET', '/v1/console/users'),
      api<{ agents: Agent[] }>('GET', '/v1/agents'),
    ]);
    return { orgs: o.orgs, users: u.users, agents: ag.agents };
  }, []);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  // Verifying a business also verifies every agent it owns (and later ones inherit it).
  async function verify(org: Org, level: number) {
    try {
      await api('POST', `/v1/console/orgs/${org.id}/verify`, { level });
      toast('Verification updated for the organization and its agents');
    } catch (err) { toast(errorMessage(err), true); }
    await reload();
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    try {
      await api('POST', '/v1/console/orgs', { name });
      setName('');
      toast('Organization created');
      await reload();
    } catch (err) { setFormError(errorMessage(err)); }
  }

  return (
    <div className="tab">
      <FormPanel title="New organization">
        <form className="inline-form" onSubmit={create}>
          <div><label htmlFor="og-name">Name</label><input id="og-name" maxLength={80} required value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="end"><button className="btn primary" type="submit">Create</button></div>
        </form>
        <p className="form-error" role="alert">{formError}</p>
      </FormPanel>
      <Panel title="Organizations">
        <table>
          <thead><tr><th>Organization</th><th>Verification</th><th>Agents</th><th>People</th><th>Source</th><th>Created</th></tr></thead>
          <tbody>
            {data.orgs.map((o) => (
              <tr key={o.id}>
                <td className="name">{o.name}</td>
                <td>
                  <select aria-label={`Verification for ${o.name}`} value={o.verification || 0} onChange={(e) => verify(o, Number(e.target.value))}>
                    {VERIFY.map((v, i) => <option key={v} value={i}>{v}</option>)}
                  </select>
                </td>
                <td>{data.agents.filter((a) => a.orgId === o.id).length}</td>
                <td>{data.users.filter((p) => p.orgId === o.id).length}</td>
                <td className="muted">{o.createdVia === 'signup' ? 'Self-signup' : 'Created by staff'}</td>
                <td className="muted">{when(o.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
