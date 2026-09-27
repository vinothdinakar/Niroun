'use client';

import { NotAllowed, Panel } from '@bond/console-core/components/ui';
import { api } from '@bond/console-core/lib/api';
import { when } from '@bond/console-core/lib/format';
import { useLoader } from '@bond/console-core/lib/hooks';
import { useSession } from '@bond/console-core/lib/session';
import type { AuditEntry } from '@bond/console-core/lib/types';

// Staff-only: the audit log spans every organization, so it doesn't exist in the customer dashboard.
export default function AuditPage() {
  const { has } = useSession();
  return has('audit') ? <Audit /> : <NotAllowed />;
}

function Audit() {
  const { data, error } = useLoader(() => api<{ entries: AuditEntry[] }>('GET', '/v1/console/audit'), []);
  if (error) return <p className="form-error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <Panel title="Audit log" hint="sign-ins and every change made in either console" scrollMax={640}>
      <table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>
          {data.entries.map((e, i) => (
            <tr key={i}>
              <td className="muted">{when(e.ts)}</td>
              <td>{e.actorEmail || '—'}</td>
              <td><code>{e.action}</code></td>
              <td className="muted"><code>{e.target || ''}</code></td>
              <td className="reasons">{JSON.stringify(e.detail)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
