import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import OrganizationsPage from './page';

const baseUser = {
  id: 'usr_1', email: 'ada@bond.test', name: 'Ada Admin', orgId: null as string | null, orgName: null as string | null,
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'enabled' as const, recoveryCodesLeft: 5,
};
const adminMe = { user: { ...baseUser, role: 'admin' as const }, permissions: ['orgs'] };
const reviewerMe = { user: { ...baseUser, role: 'reviewer' as const }, permissions: [] };

describe('OrganizationsPage', () => {
  it('refuses a reviewer, who has no orgs permission — same as the API would', async () => {
    mockApi({ '/v1/auth/me': reviewerMe });
    renderWithProviders(<OrganizationsPage />);
    expect(await screen.findByText('Not available')).toBeInTheDocument();
  });

  it('lists organizations and lets an admin change verification level', async () => {
    const fetchMock = mockApi({
      '/v1/auth/me': adminMe,
      '/v1/console/orgs': (_url: string, init?: RequestInit) =>
        init?.method === 'POST' ? {} : { orgs: [{ id: 'org_1', name: 'Acme Corp', verification: 0, createdVia: 'signup', createdAt: 0 }] },
      '/v1/console/users': { users: [] },
      '/v1/agents': { agents: [] },
      '/v1/console/orgs/org_1/verify': {},
    });
    const user = userEvent.setup();
    renderWithProviders(<OrganizationsPage />);
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Verification for Acme Corp'), '1');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/console/orgs/org_1/verify', expect.objectContaining({ method: 'POST' })));

    await user.type(screen.getByLabelText('Name'), 'New Co');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/console/orgs', expect.objectContaining({ method: 'POST' })));
  });
});
