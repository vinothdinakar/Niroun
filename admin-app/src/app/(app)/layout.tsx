import { AppShell, type NavTab } from '@bond/console-core/components/app-shell';
import type { ReactNode } from 'react';

const TABS: NavTab[] = [
  { href: '/', label: 'Overview' },
  { href: '/deals', label: 'Deals' },
  { href: '/disputes', label: 'Disputes' },
  { href: '/agents', label: 'Agent Marketplace' },
  { href: '/connect', label: 'Connect agents', needs: 'enroll' },
  { href: '/team', label: 'Team', needs: 'team_manage' },
  { href: '/organizations', label: 'Organizations', needs: 'orgs' },
  { href: '/audit', label: 'Audit log', needs: 'audit' },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell tabs={TABS} badge="STAFF">{children}</AppShell>;
}
