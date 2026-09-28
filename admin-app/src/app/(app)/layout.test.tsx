import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import AppLayout from './layout';

const baseUser = {
  id: 'usr_1', email: 'ada@bond.test', name: 'Ada Admin', orgId: null as string | null, orgName: null as string | null,
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'enabled' as const, recoveryCodesLeft: 5,
};

describe('admin-app app layout', () => {
  it('shows every staff section, plus a STAFF badge so nobody confuses this for the customer dashboard', async () => {
    mockApi({
      '/v1/auth/me': {
        user: { ...baseUser, role: 'admin' },
        permissions: ['stats', 'orgs', 'audit', 'verify', 'sweep', 'resolve', 'agents_manage', 'agents_suspend', 'team_manage', 'enroll'],
      },
    });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.getByText('STAFF')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Organizations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect agents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Deals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Disputes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agent Marketplace' })).toBeInTheDocument();
  });

  it('hides Organizations/Audit/Team for a reviewer, who holds none of those permissions', async () => {
    mockApi({ '/v1/auth/me': { user: { ...baseUser, role: 'reviewer' }, permissions: ['stats', 'resolve', 'agents_suspend'] } });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.queryByRole('link', { name: 'Organizations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
    // reading (Deals/Disputes/Agent Marketplace) is not permission-gated — a reviewer still sees them
    expect(screen.getByRole('link', { name: 'Deals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Disputes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agent Marketplace' })).toBeInTheDocument();
  });
});
