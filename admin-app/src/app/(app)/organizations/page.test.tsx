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
        init?.method === 'POST' ? {} : { orgs: [{ id: 'org_1', name: 'Acme Corp', accountType: 'business', verification: 0, createdVia: 'signup', createdAt: 0 }] },
      '/v1/console/users': { users: [] },
      '/v1/agents': { agents: [] },
      '/v1/console/verification-requests': { requests: [] },
      '/v1/console/orgs/org_1/verify': {},
    });
    const user = userEvent.setup();
    renderWithProviders(<OrganizationsPage />);
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Fully verified (KYB)')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Verification for Acme Corp'), '1');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/console/orgs/org_1/verify', expect.objectContaining({ method: 'POST' })));

    await user.type(screen.getByLabelText('Name'), 'New Co');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/console/orgs', expect.objectContaining({ method: 'POST' })));
    const createCall = fetchMock.mock.calls.findLast(([url, init]) => url === '/v1/console/orgs' && init?.method === 'POST');
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ name: 'New Co', accountType: 'business' });
  });

  it('shows individual-flavoured verification labels for a personal account, and lets an admin correct the type', async () => {
    const fetchMock = mockApi({
      '/v1/auth/me': adminMe,
      '/v1/console/orgs': { orgs: [{ id: 'org_2', name: 'Jordan Lee', accountType: 'individual', verification: 0, createdVia: 'signup', createdAt: 0 }] },
      '/v1/console/users': { users: [] },
      '/v1/agents': { agents: [] },
      '/v1/console/verification-requests': { requests: [] },
      '/v1/console/orgs/org_2/account-type': {},
    });
    const user = userEvent.setup();
    renderWithProviders(<OrganizationsPage />);
    expect(await screen.findByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('Fully verified (KYC)')).toBeInTheDocument();
    expect(screen.queryByText('Fully verified (KYB)')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Type for Jordan Lee'), 'business');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/console/orgs/org_2/account-type', expect.objectContaining({ method: 'POST' })));
    const retypeCall = fetchMock.mock.calls.findLast(([url]) => url === '/v1/console/orgs/org_2/account-type');
    expect(JSON.parse(String(retypeCall?.[1]?.body))).toMatchObject({ accountType: 'business' });
  });

  it('shows a pending verification request with its submitted fields, and lets an admin approve or reject it', async () => {
    const pendingRequest = {
      id: 'ver_1', orgId: 'org_1', accountType: 'business' as const, level: 1 as const, status: 'pending' as const,
      fields: { legalName: 'Acme Corporation LLC', registrationNumber: 'EIN-1', address: '1 Main St' },
      documents: [
        { id: 'doc_1', orgId: 'org_1', kind: 'incorporation' as const, filename: 'cert.pdf', contentType: 'application/pdf', size: 2048, uploadedAt: 0, requestId: 'ver_1' },
        { id: 'doc_2', orgId: 'org_1', kind: 'address_proof' as const, filename: 'bill.png', contentType: 'image/png', size: 1024, uploadedAt: 0, requestId: 'ver_1', purgedAt: 5 },
      ],
      submittedBy: 'usr_owner', submittedAt: 0,
    };
    const fetchMock = mockApi({
      '/v1/auth/me': adminMe,
      '/v1/console/orgs': { orgs: [{ id: 'org_1', name: 'Acme Corp', accountType: 'business', verification: 0, createdVia: 'signup', createdAt: 0 }] },
      '/v1/console/users': { users: [] },
      '/v1/agents': { agents: [] },
      '/v1/console/verification-requests': { requests: [pendingRequest] },
      '/v1/console/verification-requests/ver_1/decide': {},
    });
    const user = userEvent.setup();
    renderWithProviders(<OrganizationsPage />);
    expect(await screen.findByText('Acme Corp — applying for Owner verified')).toBeInTheDocument();
    expect(screen.getByText('Acme Corporation LLC')).toBeInTheDocument();
    expect(screen.getByText('EIN-1')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'cert.pdf' })).toHaveAttribute('href', '/v1/console/verification-documents/doc_1');
    expect(screen.getByText(/bill\.png — deleted .* under the retention policy/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'bill.png' })).not.toBeInTheDocument();

    // rejecting without a reason is refused client-side, before any request is sent
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    expect(fetchMock).not.toHaveBeenCalledWith('/v1/console/verification-requests/ver_1/decide', expect.anything());

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/console/verification-requests/ver_1/decide', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse(String(fetchMock.mock.calls.findLast(([url]) => url === '/v1/console/verification-requests/ver_1/decide')?.[1]?.body));
    expect(body).toMatchObject({ decision: 'approve' });
  });
});
