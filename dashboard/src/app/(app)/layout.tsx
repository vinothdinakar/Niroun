import { AppShell, type NavTab } from '@bond/console-core/components/app-shell';
import type { ReactNode } from 'react';

// Organizations and the Audit log aren't here: customers never have the 'orgs' or 'audit' permissions
// (those are Bond-staff-only concepts, handled in the separate admin-app), so there's nothing to show.
const TABS: NavTab[] = [
  { href: '/', label: 'Overview' },
  { href: '/deals', label: 'Deals' },
  { href: '/disputes', label: 'Disputes' },
  { href: '/agents', label: 'Agent Marketplace' },
  { href: '/connect', label: 'Connect agents', needs: 'enroll' },
  { href: '/verification', label: 'Verification', needs: 'request_verification' },
  { href: '/team', label: 'Team', needs: 'team_manage' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell tabs={TABS}>{children}</AppShell>;
}
