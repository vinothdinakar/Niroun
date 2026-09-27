'use client';

import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { when } from '../lib/format';
import { useSession } from '../lib/session';
import { useCopy, useToast } from '../lib/toast';
import type { Agent, Enrollment, Org } from '../lib/types';
import { useAgentDrawer } from './agent-drawer';
import { useLoaderShim } from './use-loader-shim';
import { EmptyRow, FormPanel, NotAllowed, Panel, StatusPill, Tier } from './ui';

export function ConnectView() {
  const { has } = useSession();
  return has('enroll') ? <Connect /> : <NotAllowed />;
}

function Connect() {
  const { me, isStaff } = useSession();
  const drawer = useAgentDrawer();
  const toast = useToast();
  const copy = useCopy();
  const { data, error } = useLoaderShim(async () => {
    const [orgs, ag] = await Promise.all([api<{ orgs: Org[] }>('GET', '/v1/console/orgs'), api<{ agents: Agent[] }>('GET', '/v1/agents')]);
    return { orgs: orgs.orgs, agents: ag.agents };
  }, [drawer.version]);
  const [orgId, setOrgId] = useState('');
  const [label, setLabel] = useState('');
  const [result, setResult] = useState<Enrollment | null>(null);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const selectedOrg = orgId || data.orgs[0]?.id || '';
  const linked = data.agents.filter((a) => (isStaff ? a.orgId : a.orgId === me?.user.orgId));

  async function generate() {
    try {
      setResult(await api<Enrollment>('POST', '/v1/console/enrollments', { orgId: isStaff ? selectedOrg : undefined, label }));
      setLabel('');
    } catch (err) {
      toast(errorMessage(err), true);
    }
  }

  return (
    <div className="tab">
      <FormPanel title="Connect an agent">
        <p className="muted">Generate a one-time enrollment code and give it to the developer of your agent. When the agent registers with it, it is linked to your organization: its owner is verified, and only your admins can change its spending limits or suspend it.</p>
        {isStaff && (
          <div>
            <label htmlFor="cn-org">Organization</label>
            <select id="cn-org" value={selectedOrg} onChange={(e) => setOrgId(e.target.value)}>
              {data.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
        )}
        <label htmlFor="cn-label">Label <span className="muted">(optional, e.g. the agent&apos;s name)</span></label>
        <input id="cn-label" maxLength={80} placeholder="ProcureBot" value={label} onChange={(e) => setLabel(e.target.value)} />
        <p><button className="btn primary" onClick={generate}>Generate enrollment code</button></p>
        {result && (
          <div className="secret">
            <strong>Enrollment code for {result.orgName}</strong>
            <code>{result.code}</code>
            <button className="btn ghost sm" onClick={() => copy(result.code)}>Copy code</button>
            <p className="muted small">Shown once. Single use, and it expires {when(result.expiresAt)}. Treat it like a password.</p>
            <pre>{`const bond = await BondClient.register({
  baseUrl, name: 'YourAgent', owner: '${result.orgName}',
  enrollmentCode: '${result.code}',
});`}</pre>
          </div>
        )}
      </FormPanel>

      <Panel title="Connected agents">
        <table>
          <thead><tr><th>Agent</th><th>Organization</th><th>Tier</th><th>Status</th></tr></thead>
          <tbody>
            {linked.length ? linked.map((a) => (
              <tr key={a.id} className="click" onClick={() => drawer.open(a.id)}>
                <td className="name"><button className="rowbtn" onClick={(e) => { e.stopPropagation(); drawer.open(a.id); }}>{a.name}</button></td>
                <td>{a.owner}</td>
                <td><Tier tier={a.tier} /> {a.score}</td>
                <td><StatusPill suspended={a.status === 'suspended'} /></td>
              </tr>
            )) : <EmptyRow cols={4}>No connected agents yet.</EmptyRow>}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
