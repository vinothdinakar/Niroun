import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import VerificationPage from './page';

const baseUser = {
  id: 'usr_1', email: 'ada@acme.test', name: 'Ada Owner', orgId: 'org_1', orgName: 'Acme Corp',
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off' as const, recoveryCodesLeft: null,
};

const org = (overrides: Record<string, unknown> = {}) => ({
  id: 'org_1', name: 'Acme Corp', accountType: 'business', verification: 0, createdVia: 'signup', createdAt: 0, ...overrides,
});

describe('VerificationPage', () => {
  it('hides the page from a viewer, who has no request_verification permission', async () => {
    mockApi({ '/v1/auth/me': { user: baseUser, permissions: [] } });
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText('Not available')).toBeInTheDocument();
  });

  it('walks an owner through applying: level, then details, then review and submit', async () => {
    const fetchMock = mockApi({
      '/v1/auth/me': { user: baseUser, permissions: ['request_verification'] },
      '/v1/console/orgs': { orgs: [org()] },
      '/v1/console/verification-requests': (_url: string, init?: RequestInit) => (init?.method === 'POST' ? {} : { requests: [] }),
    });
    renderWithProviders(<VerificationPage />);
    await screen.findByText('1. Level');

    fireEvent.click(screen.getByRole('radio', { name: 'Owner verified' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByLabelText('Legal business name');
    fireEvent.change(screen.getByLabelText('Legal business name'), { target: { value: 'Acme Corporation LLC' } });
    fireEvent.change(screen.getByLabelText('Registration number'), { target: { value: 'EIN-123' } });
    fireEvent.change(screen.getByLabelText('Business address'), { target: { value: '1 Main St' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText('Review your application');
    expect(screen.getByText('Acme Corporation LLC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/console/verification-requests', expect.objectContaining({ method: 'POST' })));
    const call = fetchMock.mock.calls.findLast(([url, init]) => url === '/v1/console/verification-requests' && init?.method === 'POST');
    const body = JSON.parse(String(call?.[1]?.body));
    expect(body).toMatchObject({ level: 1, fields: { legalName: 'Acme Corporation LLC', registrationNumber: 'EIN-123', address: '1 Main St' } });
  });

  it('shows a pending application instead of the wizard, with what was submitted', async () => {
    mockApi({
      '/v1/auth/me': { user: baseUser, permissions: ['request_verification'] },
      '/v1/console/orgs': { orgs: [org()] },
      '/v1/console/verification-requests': {
        requests: [{
          id: 'ver_1', orgId: 'org_1', accountType: 'business', level: 1, status: 'pending',
          fields: { legalName: 'Acme Corporation LLC', registrationNumber: 'EIN-123', address: '1 Main St' },
          submittedBy: 'usr_1', submittedAt: 0,
        }],
      },
    });
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText('Application pending review')).toBeInTheDocument();
    expect(screen.getByText('Acme Corporation LLC')).toBeInTheDocument();
    expect(screen.queryByText('1. Level')).not.toBeInTheDocument();
  });

  it('shows the rejection reason and lets the owner resubmit, pre-filled with what they sent before', async () => {
    mockApi({
      '/v1/auth/me': { user: baseUser, permissions: ['request_verification'] },
      '/v1/console/orgs': { orgs: [org()] },
      '/v1/console/verification-requests': {
        requests: [{
          id: 'ver_1', orgId: 'org_1', accountType: 'business', level: 1, status: 'rejected',
          fields: { legalName: 'Acme Corporation LLC', registrationNumber: 'EIN-123', address: '1 Main St' },
          submittedBy: 'usr_1', submittedAt: 0, decidedAt: 1, decidedBy: 'usr_staff', rejectionReason: 'Registration number does not match records',
        }],
      },
    });
    renderWithProviders(<VerificationPage />);
    await screen.findByText(/Registration number does not match records/);
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); // step 1 -> 2
    expect(await screen.findByDisplayValue('Acme Corporation LLC')).toBeInTheDocument();
  });

  it('shows a completion message once fully verified, with no more form', async () => {
    mockApi({
      '/v1/auth/me': { user: baseUser, permissions: ['request_verification'] },
      '/v1/console/orgs': { orgs: [org({ verification: 2 })] },
      '/v1/console/verification-requests': { requests: [] },
    });
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText(/Fully verified — there's nothing further to apply for/)).toBeInTheDocument();
  });
});
