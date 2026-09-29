'use client';

import { DocumentList, ReviewList } from '@bond/console-core/components/verification-view';
import { FormPanel, NotAllowed, Panel } from '@bond/console-core/components/ui';
import { api } from '@bond/console-core/lib/api';
import { errorMessage } from '@bond/console-core/lib/api';
import { orgVerifyLabel, VERIFY_FIELD_SPEC, when } from '@bond/console-core/lib/format';
import { useLoader } from '@bond/console-core/lib/hooks';
import { useSession } from '@bond/console-core/lib/session';
import { useToast } from '@bond/console-core/lib/toast';
import type { Agent, Org, PersonRow, VerificationRequest } from '@bond/console-core/lib/types';
import { useState, type FormEvent } from 'react';

// Staff-only: customers never create or verify organizations, so this page doesn't exist in the dashboard app.
export default function OrganizationsPage() {
  const { has } = useSession();
  return has('orgs') ? <Organizations /> : <NotAllowed />;
}

function Organizations() {
  const toast = useToast();
  const { data, error, reload } = useLoader(async () => {
    const [o, u, ag, vr] = await Promise.all([
      api<{ orgs: Org[] }>('GET', '/v1/console/orgs'),
      api<{ users: PersonRow[] }>('GET', '/v1/console/users'),
      api<{ agents: Agent[] }>('GET', '/v1/agents'),
      api<{ requests: VerificationRequest[] }>('GET', '/v1/console/verification-requests'),
    ]);
    return { orgs: o.orgs, users: u.users, agents: ag.agents, requests: vr.requests };
  }, []);
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<'individual' | 'business'>('business');
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

  // Correcting the type never touches verification — it's just relabelling.
  async function retype(org: Org, type: 'individual' | 'business') {
    try {
      await api('POST', `/v1/console/orgs/${org.id}/account-type`, { accountType: type });
      toast('Organization type updated');
    } catch (err) { toast(errorMessage(err), true); }
    await reload();
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    setFormError('');
    try {
      await api('POST', '/v1/console/orgs', { name, accountType });
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
          <div>
            <label htmlFor="og-type">Type</label>
            <select id="og-type" value={accountType} onChange={(e) => setAccountType(e.target.value as typeof accountType)}>
              <option value="business">Business</option>
              <option value="individual">Individual</option>
            </select>
          </div>
          <div className="end"><button className="btn primary" type="submit">Create</button></div>
        </form>
        <p className="form-error" role="alert">{formError}</p>
      </FormPanel>
      <VerificationQueue requests={data.requests} orgs={data.orgs} onDecided={reload} />
      <Panel title="Organizations">
        <table>
          <thead><tr><th>Organization</th><th>Type</th><th>Verification</th><th>Agents</th><th>People</th><th>Source</th><th>Created</th></tr></thead>
          <tbody>
            {data.orgs.map((o) => (
              <tr key={o.id}>
                <td className="name">{o.name}</td>
                <td>
                  <select aria-label={`Type for ${o.name}`} value={o.accountType || 'business'} onChange={(e) => retype(o, e.target.value as 'individual' | 'business')}>
                    <option value="business">Business</option>
                    <option value="individual">Individual</option>
                  </select>
                </td>
                <td>
                  <select aria-label={`Verification for ${o.name}`} value={o.verification || 0} onChange={(e) => verify(o, Number(e.target.value))}>
                    {[0, 1, 2].map((i) => <option key={i} value={i}>{orgVerifyLabel(i, o.accountType)}</option>)}
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

/** The review queue: pending applications need a decision; decided ones are kept below as a short history. */
function VerificationQueue({ requests, orgs, onDecided }: { requests: VerificationRequest[]; orgs: Org[]; onDecided: () => Promise<void> }) {
  const orgName = (orgId: string) => orgs.find((o) => o.id === orgId)?.name ?? orgId;
  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending').slice(0, 10);

  return (
    <Panel title="Verification requests" hint={pending.length ? `${pending.length} awaiting review` : 'nothing pending'}>
      {pending.length === 0 && decided.length === 0 && <p className="muted" style={{ padding: 16 }}>No applications yet.</p>}
      {pending.map((r) => <DecideRow key={r.id} request={r} orgName={orgName(r.orgId)} onDecided={onDecided} />)}
      {decided.length > 0 && (
        <table>
          <thead><tr><th>Organization</th><th>Applied for</th><th>Decision</th><th>Reason</th><th>Decided</th></tr></thead>
          <tbody>
            {decided.map((r) => (
              <tr key={r.id}>
                <td className="name">{orgName(r.orgId)}</td>
                <td>{orgVerifyLabel(r.level, r.accountType)}</td>
                <td><span className={`pill ${r.status === 'approved' ? 'green' : 'red'}`}>{r.status === 'approved' ? 'Approved' : 'Rejected'}</span></td>
                <td className="muted">{r.rejectionReason || '—'}</td>
                <td className="muted">{when(r.decidedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function DecideRow({ request, orgName, onDecided }: { request: VerificationRequest; orgName: string; onDecided: () => Promise<void> }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'approve' | 'reject') {
    if (decision === 'reject' && !reason.trim()) { toast('A rejection needs a reason', true); return; }
    setBusy(true);
    try {
      await api('POST', `/v1/console/verification-requests/${request.id}/decide`, { decision, reason });
      toast(decision === 'approve' ? 'Application approved' : 'Application rejected');
      await onDecided();
    } catch (err) {
      toast(errorMessage(err), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="manage">
      <h4>{orgName} — applying for {orgVerifyLabel(request.level, request.accountType)}</h4>
      <p className="muted small">Submitted {when(request.submittedAt)}</p>
      <ReviewList rows={VERIFY_FIELD_SPEC[request.accountType].filter((f) => request.fields[f.key]).map((f): [string, string] => [f.label, request.fields[f.key]])} />
      <DocumentList docs={request.documents} accountType={request.accountType} />
      <div className="review">
        <input aria-label={`Rejection reason for ${orgName}`} placeholder="Reason (needed if rejecting)" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
        <button className="btn primary sm" onClick={() => decide('approve')} disabled={busy}>Approve</button>
        <button className="btn danger sm" onClick={() => decide('reject')} disabled={busy}>Reject</button>
      </div>
    </div>
  );
}
