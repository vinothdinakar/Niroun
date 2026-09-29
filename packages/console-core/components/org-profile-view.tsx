'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { orgVerifyLabel, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { Org } from '../lib/types';
import { useLoaderShim } from './use-loader-shim';
import { FormPanel } from './ui';

const FIELDS = [
  { key: 'about', label: 'About', max: 500, multiline: true, placeholder: 'What your organization does and what its agents are for' },
  { key: 'website', label: 'Website', max: 200, placeholder: 'https://example.com' },
  { key: 'contactEmail', label: 'Contact email', max: 120, placeholder: 'hello@example.com' },
  { key: 'country', label: 'Country', max: 60, placeholder: 'Canada' },
  { key: 'industry', label: 'Industry', max: 80, placeholder: 'Logistics' },
] as const;

type Draft = Record<(typeof FIELDS)[number]['key'], string>;
const draftOf = (org: Org): Draft => ({ about: org.about ?? '', website: org.website ?? '', contactEmail: org.contactEmail ?? '', country: org.country ?? '', industry: org.industry ?? '' });

// The organization's own profile: who they are, how to reach them. Admins edit it; everyone else in the org reads it.
export function OrgProfileView() {
  const { data, error } = useLoaderShim(async () => (await api<{ orgs: Org[] }>('GET', '/v1/console/orgs')).orgs[0], []);
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  return <Profile initial={data} />;
}

function Profile({ initial }: { initial: Org }) {
  const { has } = useSession();
  const toast = useToast();
  const canEdit = has('org_manage');
  const [org, setOrg] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = FIELDS.some((f) => draft[f.key].trim() !== (org[f.key] ?? ''));
  const level = org.verification || 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const saved = await api<Org>('PUT', `/v1/console/orgs/${org.id}/profile`, draft);
      setOrg(saved);
      setDraft(draftOf(saved));
      toast('Profile saved');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab">
      <FormPanel title={org.name}>
        <p>
          <span className={`pill ${level >= 2 ? 'green' : level === 1 ? 'blue' : 'gray'}`}>{orgVerifyLabel(level, org.accountType)}</span>
        </p>
        <p className="muted small">
          {org.accountType === 'individual' ? 'Individual account' : 'Business account'} · member since {when(org.createdAt)}
        </p>
        <form onSubmit={save}>
          {FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`op-${f.key}`}>{f.label}</label>
              {'multiline' in f ? (
                <textarea
                  id={`op-${f.key}`} rows={4} maxLength={f.max} placeholder={f.placeholder}
                  value={draft[f.key]} readOnly={!canEdit}
                  onChange={(e) => setDraft((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              ) : (
                <input
                  id={`op-${f.key}`} maxLength={f.max} placeholder={f.placeholder}
                  value={draft[f.key]} readOnly={!canEdit}
                  onChange={(e) => setDraft((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <p className="form-error" role="alert">{error}</p>
          {canEdit ? (
            <div className="row-end">
              <button className="btn primary" type="submit" disabled={busy || !dirty}>Save profile</button>
            </div>
          ) : (
            <p className="muted small">Only your organization&apos;s admins can edit this profile.</p>
          )}
        </form>
      </FormPanel>
    </div>
  );
}
