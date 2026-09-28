import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import AppLayout from './layout';

const baseUser = {
  id: 'usr_1', email: 'ada@bond.test', name: 'Ada Admin', orgId: null as string | null, orgName: null as string | null,
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'enabled' as const, recoveryCodesLeft: 5,
};

describe('dashboard app layout', () => {
  it('never shows Organizations or Audit log, even for a staff session', async () => {
    // A dashboard-served page can't grant staff-only sections by accident: its nav list simply doesn't
    // include them, regardless of what the signed-in account is allowed to do.
    mockApi({
      '/v1/auth/me': {
        user: { ...baseUser, role: 'admin' },
        permissions: ['stats', 'orgs', 'audit', 'verify', 'sweep', 'resolve', 'agents_manage', 'agents_suspend', 'team_manage', 'enroll'],
      },
    });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.queryByRole('link', { name: /Organizations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Audit log/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect agents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument();
  });

  it('hides Connect/Verification/Team for an owner_viewer, who holds none of those permissions', async () => {
    mockApi({ '/v1/auth/me': { user: { ...baseUser, role: 'owner_viewer', orgId: 'org_1', orgName: 'Acme Corp' }, permissions: [] } });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.queryByRole('link', { name: 'Connect agents' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Verification' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
  });

  it('shows Verification to an owner_admin, who can apply on their org\'s behalf', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin', orgId: 'org_1', orgName: 'Acme Corp' }, permissions: ['agents_manage', 'agents_suspend', 'team_manage', 'enroll', 'request_verification'] },
    });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.getByRole('link', { name: 'Verification' })).toBeInTheDocument();
  });

  it('shows Deals, Disputes and Agent Marketplace to every role — reading is scoped, not permission-gated', async () => {
    mockApi({ '/v1/auth/me': { user: { ...baseUser, role: 'owner_viewer', orgId: 'org_1', orgName: 'Acme Corp' }, permissions: [] } });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.getByRole('link', { name: 'Deals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Disputes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agent Marketplace' })).toBeInTheDocument();
  });
});
