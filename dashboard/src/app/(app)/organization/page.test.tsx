import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import OrganizationPage from './page';

const baseUser = {
  id: 'usr_1', email: 'ada@acme.test', name: 'Ada Owner', orgId: 'org_1', orgName: 'Acme Corp', role: 'owner_admin' as const,
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off' as const, recoveryCodesLeft: null,
};
const org = { id: 'org_1', name: 'Acme Corp', accountType: 'business', verification: 0, createdAt: 0 };
const routes = (permissions: string[], role = 'owner_admin') => ({
  '/v1/auth/me': { user: { ...baseUser, role }, permissions },
  '/v1/console/orgs': { orgs: [org] },
  '/v1/console/verification-requests': { requests: [] },
  '/v1/console/users': { users: [baseUser] },
});

afterEach(() => { window.location.hash = ''; });

describe('OrganizationPage', () => {
  it('offers Profile, Verification and Team to an org admin, opening on the profile', async () => {
    mockApi(routes(['org_manage', 'request_verification', 'team_manage']));
    renderWithProviders(<OrganizationPage />);
    expect(await screen.findByLabelText('About')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Profile', 'Verification', 'Team']);

    fireEvent.click(screen.getByRole('tab', { name: 'Verification' }));
    expect(await screen.findByText('1. Level')).toBeInTheDocument();
    expect(window.location.hash).toBe('#verification');
  });

  it('opens straight to a section named in the address', async () => {
    window.location.hash = '#verification';
    mockApi(routes(['org_manage', 'request_verification', 'team_manage']));
    renderWithProviders(<OrganizationPage />);
    expect(await screen.findByText('1. Level')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Verification' })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows a viewer only the profile, and ignores an address for a section they cannot use', async () => {
    window.location.hash = '#team';
    mockApi(routes([], 'owner_viewer'));
    renderWithProviders(<OrganizationPage />);
    expect(await screen.findByLabelText('About')).toHaveAttribute('readonly');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Profile']);
  });
});
