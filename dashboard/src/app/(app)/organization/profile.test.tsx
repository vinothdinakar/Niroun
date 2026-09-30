import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import { OrgProfileView as ProfilePage } from '@bond/console-core/components/org-profile-view';

const baseUser = {
  id: 'usr_1', email: 'ada@acme.test', name: 'Ada Owner', orgId: 'org_1', orgName: 'Acme Corp', role: 'owner_admin' as const,
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off' as const, recoveryCodesLeft: null,
};
const org = { id: 'org_1', name: 'Acme Corp', accountType: 'business', verification: 1, createdAt: 0, about: 'We build agents.', country: 'Canada' };

describe('ProfilePage', () => {
  it('lets an org admin edit the profile and saves only through the profile endpoint', async () => {
    const fetchMock = mockApi({
      '/v1/auth/me': { user: baseUser, permissions: ['org_manage'] },
      '/v1/console/orgs': { orgs: [org] },
      '/v1/console/orgs/org_1/profile': { ...org, website: 'https://acme.test' },
    });
    renderWithProviders(<ProfilePage />);
    expect(await screen.findByLabelText('About')).toHaveValue('We build agents.');
    expect(screen.getByLabelText('Country')).toHaveValue('Canada');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'https://acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/v1/console/orgs/org_1/profile' && init?.method === 'PUT')).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]?.body))).toMatchObject({ website: 'https://acme.test', about: 'We build agents.' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled());
  });

  it('lets an admin rename the organization and set its type before verification starts', async () => {
    const fresh = { ...org, name: 'pat’s organization', verification: 0 };
    const fetchMock = mockApi({
      '/v1/auth/me': { user: baseUser, permissions: ['org_manage'] },
      '/v1/console/orgs': { orgs: [fresh] },
      '/v1/console/orgs/org_1/profile': { ...fresh, name: 'Pat Freelance', accountType: 'individual' },
    });
    renderWithProviders(<ProfilePage />);
    const type = await screen.findByLabelText('Account type');
    expect(type).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText('Organization name'), { target: { value: 'Pat Freelance' } });
    fireEvent.change(type, { target: { value: 'individual' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(String(put[1]?.body))).toMatchObject({ name: 'Pat Freelance', accountType: 'individual' });
  });

  it('locks the account type once verification has started', async () => {
    mockApi({ '/v1/auth/me': { user: baseUser, permissions: ['org_manage'] }, '/v1/console/orgs': { orgs: [org] } });
    renderWithProviders(<ProfilePage />);
    expect(await screen.findByLabelText('Account type')).toBeDisabled();
  });

  it('shows the profile read-only to someone who cannot manage the org', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_viewer' }, permissions: [] },
      '/v1/console/orgs': { orgs: [org] },
    });
    renderWithProviders(<ProfilePage />);
    expect(await screen.findByLabelText('About')).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: 'Save profile' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only your organization/)).toBeInTheDocument();
  });

  it('shows a save error from the API', async () => {
    mockApi({
      '/v1/auth/me': { user: baseUser, permissions: ['org_manage'] },
      '/v1/console/orgs': { orgs: [org] },
      '/v1/console/orgs/org_1/profile': () => { throw Object.assign(new Error('website must be a full http(s) address'), { status: 400 }); },
    });
    renderWithProviders(<ProfilePage />);
    fireEvent.change(await screen.findByLabelText('Website'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement();
  });
});
