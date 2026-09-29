'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage, qs, uploadFile } from '../lib/api';
import { DOC_ACCEPT, fileSize, MAX_DOC_MB, orgVerifyLabel, VERIFY_DOC_LABEL, VERIFY_DOC_SPEC, VERIFY_FIELD_SPEC, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Org, VerificationDocument, VerificationRequest } from '../lib/types';
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

/** The evidence attached to an application, each a private, authorised download (never a public link). */
export function DocumentList({ docs, accountType }: { docs: VerificationDocument[] | undefined; accountType: 'individual' | 'business' }) {
  if (!docs?.length) return <p className="muted small">No documents attached.</p>;
  return (
    <ul className="doc-list">
      {docs.map((d) => (
        <li key={d.id}>
          <span className="muted">{VERIFY_DOC_LABEL(accountType, d.kind)}: </span>
          {d.purgedAt ? (
            <span className="muted">{d.filename} — deleted {when(d.purgedAt)} under the retention policy</span>
          ) : (
            <a href={`/v1/console/verification-documents/${d.id}`}>{d.filename}</a>
          )}
          {!d.purgedAt && <span className="muted"> ({fileSize(d.size)})</span>}
        </li>
      ))}
    </ul>
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
            <DocumentList docs={pending.documents} accountType={org.accountType} />
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
  const docSpec = VERIFY_DOC_SPEC[org.accountType];
  const [docs, setDocs] = useState<Partial<Record<string, VerificationDocument>>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [docError, setDocError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: string) => (e: { target: { value: string } }) => setFields((s) => ({ ...s, [key]: e.target.value }));
  const missingDoc = docSpec.some((d) => d.required && !docs[d.kind]);

  // A file goes up as soon as it is chosen; the application then just names the uploaded files.
  async function pick(kind: string, file: File | undefined) {
    if (!file) return;
    setDocError('');
    if (file.size > MAX_DOC_MB * 1024 * 1024) { setDocError(`${file.name} is larger than ${MAX_DOC_MB} MB`); return; }
    setUploading(kind);
    try {
      const doc = await uploadFile<VerificationDocument>(`/v1/console/verification-documents${qs({ kind, filename: file.name })}`, file);
      setDocs((s) => ({ ...s, [kind]: doc }));
    } catch (err) {
      setDocError(errorMessage(err));
    } finally {
      setUploading(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const documentIds = docSpec.flatMap((d) => (docs[d.kind] ? [docs[d.kind]!.id] : []));
      await api('POST', '/v1/console/verification-requests', { level, fields, documentIds });
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
          <h4>Documents</h4>
          <p className="muted small">PDF, PNG or JPEG, up to {MAX_DOC_MB} MB each. Bond staff use these to check what you entered above.</p>
          {docSpec.map((d) => (
            <div key={d.kind}>
              <label htmlFor={`vd-${d.kind}`}>{d.label}{d.required ? '' : ' (optional)'}</label>
              <input
                id={`vd-${d.kind}`} type="file" accept={DOC_ACCEPT}
                disabled={uploading !== null}
                onChange={(e) => { void pick(d.kind, e.target.files?.[0]); e.target.value = ''; }}
              />
              <p className="muted small">
                {uploading === d.kind ? 'Uploading…' : docs[d.kind] ? `Uploaded: ${docs[d.kind]!.filename} (${fileSize(docs[d.kind]!.size)})` : d.hint}
              </p>
            </div>
          ))}
          <p className="form-error" role="alert">{docError}</p>
          <div className="row-end">
            <button className="btn ghost" type="button" onClick={() => setStep(1)}>Back</button>
            <button className="btn primary" type="submit" disabled={missingDoc || uploading !== null}>Next</button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={submit}>
          <h4>Review your application</h4>
          <ReviewList rows={[['Applying for', orgVerifyLabel(level, org.accountType)], ...spec.filter((f) => fields[f.key]).map((f): [string, string] => [f.label, fields[f.key]]), ...docSpec.filter((d) => docs[d.kind]).map((d): [string, string] => [d.label, docs[d.kind]!.filename])]} />
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
