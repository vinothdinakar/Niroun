'use client';

import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { when } from '../lib/format';
import { useSession } from '../lib/session';
import { useCopy, useToast } from '../lib/toast';
import type { Org } from '../lib/types';
import { useLoaderShim } from './use-loader-shim';
import { FormPanel } from './ui';

const FIELDS = [
  { key: 'about', label: 'About', max: 500, multiline: true, placeholder: 'What your organization does and what its agents are for' },
  { key: 'website', label: 'Website', max: 200, placeholder: 'https://example.com' },
  { key: 'country', label: 'Country', max: 60, placeholder: 'Canada' },
  { key: 'industry', label: 'Industry', max: 80, placeholder: 'Logistics' },
] as const;

type Draft = Record<(typeof FIELDS)[number]['key'], string>;
const draftOf = (org: Org): Draft => ({ about: org.about ?? '', website: org.website ?? '', country: org.country ?? '', industry: org.industry ?? '' });

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
  const copy = useCopy();
  const canEdit = has('org_manage');
  const [org, setOrg] = useState(initial);
  const [draft, setDraft] = useState<Draft>(() => draftOf(initial));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const dirty = FIELDS.some((f) => draft[f.key].trim() !== (org[f.key] ?? ''));

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

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setNameError('');
    setBusy(true);
    try {
      setOrg(await api<Org>('PUT', `/v1/console/orgs/${org.id}/profile`, { name: nameDraft.trim() }));
      setEditingName(false);
      toast('Organization name saved');
    } catch (err) {
      setNameError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab">
      <div className="org-facts">
        <div className="pref-card stacked">
          <div className="fact-head"><h3>Organization ID</h3>
            <button className="fact-btn" type="button" aria-label="Copy organization ID" onClick={() => void copy(org.id)}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
            </button>
          </div>
          <p className="fact-value mono">{org.id}</p>
        </div>
        <div className="pref-card stacked">
          <div className="fact-head"><h3>Organization name</h3>
            {canEdit && !editingName && (
              <button className="fact-btn" type="button" aria-label="Edit organization name" onClick={() => { setNameDraft(org.name); setNameError(''); setEditingName(true); }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
              </button>
            )}
          </div>
          {editingName ? (
            <form className="inline-field" onSubmit={saveName}>
              <input aria-label="Organization name" minLength={2} maxLength={80} required autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
              <button className="btn primary sm" type="submit" disabled={busy || !nameDraft.trim() || nameDraft.trim() === org.name}>Save</button>
              <button className="btn ghost sm" type="button" onClick={() => setEditingName(false)}>Cancel</button>
            </form>
          ) : (
            <p className="fact-value">{org.name}</p>
          )}
          {nameError && <p className="form-error" role="alert">{nameError}</p>}
        </div>
        <div className="pref-card stacked">
          <div className="fact-head"><h3>Created on</h3></div>
          <p className="fact-value">{when(org.createdAt)}</p>
        </div>
      </div>
      <FormPanel title="Profile">
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
