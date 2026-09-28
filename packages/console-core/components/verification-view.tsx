'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { orgVerifyLabel, VERIFY_FIELD_SPEC, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Org, VerificationRequest } from '../lib/types';
import { useLoaderShim } from './use-loader-shim';
import { FormPanel, NotAllowed } from './ui';

// Self-service KYB/KYC: apply for a higher verification level, in three steps (level -> details -> review),
// then wait for a Bond admin to approve or reject it. See VerificationRequestsService on the API.
export function VerificationView() {
  const { has } = useSession();
  return has('request_verification') ? <Application /> : <NotAllowed />;
}

export function ReviewList({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="review-list">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Application() {
  const { data, error, reload } = useLoaderShim(async () => {
    const [orgs, reqs] = await Promise.all([
      api<{ orgs: Org[] }>('GET', '/v1/console/orgs'),
      api<{ requests: VerificationRequest[] }>('GET', '/v1/console/verification-requests'),
    ]);
    return { org: orgs.orgs[0], requests: reqs.requests };
  }, []);

  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const { org, requests } = data;
  const level = org.verification || 0;
  const pending = requests.find((r) => r.status === 'pending');
  const lastRejected = !pending ? requests.find((r) => r.status === 'rejected') : undefined;

  return (
    <div className="tab">
      <FormPanel title="Verification">
        <p className="muted">
          {org.name} is currently <b>{orgVerifyLabel(level, org.accountType)}</b>. Verifying raises your Bond
          Score and lowers the premium your agents&apos; counterparties pay to trade with them.
        </p>
        {pending ? (
          <div className="manage">
            <h4>Application pending review</h4>
            <p className="muted small">
              Submitted {when(pending.submittedAt)} — applying for {orgVerifyLabel(pending.level, org.accountType)}.
            </p>
            <ReviewList rows={VERIFY_FIELD_SPEC[org.accountType].filter((f) => pending.fields[f.key]).map((f) => [f.label, pending.fields[f.key]])} />
          </div>
        ) : level >= 2 ? (
          <p className="ver">✓ Fully verified — there&apos;s nothing further to apply for.</p>
        ) : (
          <Wizard org={org} rejected={lastRejected} onSubmitted={reload} />
        )}
      </FormPanel>
    </div>
  );
}

function Wizard({ org, rejected, onSubmitted }: { org: Org; rejected: VerificationRequest | undefined; onSubmitted: () => Promise<void> }) {
  const toast = useToast();
  const spec = VERIFY_FIELD_SPEC[org.accountType];
  const availableLevels = ([1, 2] as const).filter((l) => l > (org.verification || 0));
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [level, setLevel] = useState<1 | 2>(availableLevels[0]);
  const [fields, setFields] = useState<Record<string, string>>(() => rejected?.fields ?? {});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: string) => (e: { target: { value: string } }) => setFields((s) => ({ ...s, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('POST', '/v1/console/verification-requests', { level, fields });
      toast('Application submitted for review');
      await onSubmitted();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="manage">
      {rejected && (
        <p className="notice">
          Your last application was rejected: &ldquo;{rejected.rejectionReason}&rdquo; You can edit and resubmit below.
        </p>
      )}
      <div className="wizard-steps">
        <span className={step === 1 ? 'active' : ''}>1. Level</span>
        <span className={step === 2 ? 'active' : ''}>2. Details</span>
        <span className={step === 3 ? 'active' : ''}>3. Review</span>
      </div>

      {step === 1 && (
        <>
          <label>What are you applying for?</label>
          <div className="checks" style={{ display: 'grid', gap: 8 }}>
            {availableLevels.map((l) => (
              <label key={l} className="check">
                <input type="radio" name="verify-level" checked={level === l} onChange={() => setLevel(l)} /> {orgVerifyLabel(l, org.accountType)}
              </label>
            ))}
          </div>
          <div className="row-end"><button className="btn primary" type="button" onClick={() => setStep(2)}>Next</button></div>
        </>
      )}

      {step === 2 && (
        <form onSubmit={(e) => { e.preventDefault(); setStep(3); }}>
          {spec.map((f) => (
            <div key={f.key}>
              <label htmlFor={`vf-${f.key}`}>{f.label}{f.optional ? ' (optional)' : ''}</label>
              <input
                id={`vf-${f.key}`} placeholder={f.placeholder} required={!f.optional} maxLength={200}
                value={fields[f.key] || ''} onChange={set(f.key)}
              />
            </div>
          ))}
          <div className="row-end">
            <button className="btn ghost" type="button" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary" type="submit">Next</button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={submit}>
          <h4>Review your application</h4>
          <ReviewList rows={[['Applying for', orgVerifyLabel(level, org.accountType)], ...spec.filter((f) => fields[f.key]).map((f): [string, string] => [f.label, fields[f.key]])]} />
          <p className="form-error" role="alert">{error}</p>
          <div className="row-end">
            <button className="btn ghost" type="button" onClick={() => setStep(2)} disabled={busy}>Back</button>
            <button className="btn primary" type="submit" disabled={busy}>Submit application</button>
          </div>
        </form>
      )}
    </div>
  );
}
