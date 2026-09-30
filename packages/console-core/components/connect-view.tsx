'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api';
import { when } from '../lib/format';
import { apiBaseUrl, docsUrl } from '../lib/site';
import { useSession } from '../lib/session';
import { useCopy, useToast } from '../lib/toast';
import type { Agent, Enrollment, Org } from '../lib/types';
import { useLoaderShim } from './use-loader-shim';
import { EmptyRow, FormPanel, NotAllowed, Panel, StatusPill, Tier } from './ui';

export function ConnectView() {
  const { has } = useSession();
  return has('enroll') ? <Connect /> : <NotAllowed />;
}

// A short, personal walk-through: where the API is, what to hand the agent's developer, and code with this organization
// (and, once generated, the enrollment code) already in it. The full reference is the public docs page.
function Quickstart({ orgName, code }: { orgName: string; code: string | null }) {
  const copy = useCopy();
  const api = apiBaseUrl();
  const docs = docsUrl();
  // JSON.stringify gives a valid JavaScript string whatever the name contains (an apostrophe in "Pat's Org", say)
  const snippet = `import { BondClient } from '@bond/sdk'; // private preview

const bond = await BondClient.register({
  baseUrl: ${api ? JSON.stringify(api) : 'process.env.BOND_URL'},
  name: "YourAgent",
  owner: ${JSON.stringify(orgName)},
  enrollmentCode: ${JSON.stringify(code ?? 'PASTE-YOUR-ENROLLMENT-CODE')},
});

console.log(await bond.me()); // your agent, linked to ${orgName}`;
  return (
    <FormPanel title="Quickstart">
      <p className="muted">Put an agent under your organization in three steps.</p>
      <ol className="quickstart">
        <li><b>Generate an enrollment code</b> above. It works once and is shown once.</li>
        <li>
          <b>Give it to your agent&apos;s developer, with your API address.</b>{' '}
          {api ? (
            <span className="inline-copy"><code>{api}</code> <button className="btn ghost sm" type="button" onClick={() => copy(api)}>Copy address</button></span>
          ) : (
            <span className="muted">Ask your administrator for it.</span>
          )}
        </li>
        <li><b>The agent registers with the code.</b> It then appears under Connected agents, owned by {orgName}, and your admins set its spending limits on its page.</li>
      </ol>
      <div className="secret">
        <strong>Example{code ? ' (with your new code)' : ''}</strong>
        <pre>{snippet}</pre>
        <button className="btn ghost sm" type="button" onClick={() => copy(snippet)}>Copy example</button>
      </div>
      <p className="muted small">
        {docs && <><a href={docs} target="_blank" rel="noopener noreferrer">Full API reference</a>: every endpoint, how requests are signed, and error codes. </>}
        The SDK is shared during the private preview.
      </p>
    </FormPanel>
  );
}

function Connect() {
  const { me, isStaff } = useSession();
  const router = useRouter();
  const toast = useToast();
  const copy = useCopy();
  const { data, error } = useLoaderShim(async () => {
    const [orgs, ag] = await Promise.all([api<{ orgs: Org[] }>('GET', '/v1/console/orgs'), api<{ agents: Agent[] }>('GET', '/v1/agents')]);
    return { orgs: orgs.orgs, agents: ag.agents };
  }, []);
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
            <p className="muted small">Shown once. Single use, and it expires {when(result.expiresAt)}. Treat it like a password. The example below now has it filled in.</p>
          </div>
        )}
      </FormPanel>

      <Quickstart orgName={data.orgs.find((o) => o.id === selectedOrg)?.name ?? me?.user.orgName ?? 'Your organization'} code={result?.code ?? null} />

      <Panel title="Connected agents">
        <table>
          <thead><tr><th>Agent</th><th>Organization</th><th>Tier</th><th>Status</th></tr></thead>
          <tbody>
            {linked.length ? linked.map((a) => (
              <tr key={a.id} className="click" onClick={() => router.push(`/agents/${a.id}`)}>
                <td className="name"><Link className="rowbtn" href={`/agents/${a.id}`} onClick={(e) => e.stopPropagation()}>{a.name}</Link></td>
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
