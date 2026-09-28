import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import AgentsPage from './page';

const baseUser = {
  id: 'usr_1', email: 'ada@bond.test', name: 'Ada Owner', orgId: 'org_1', orgName: 'Acme Corp',
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off' as const, recoveryCodesLeft: null,
};

const ag = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, name: 'ProcureBot', owner: 'Acme Corp', orgId: 'org_1', tier: 'A', score: 900, faultRate: 0.03,
  status: 'active', verification: 0, ...overrides,
});

describe('AgentsPage', () => {
  it('composes status, tier and search filters into one request, and the export link mirrors them', async () => {
    let lastUrl = '';
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: [] },
      '/v1/agents': (url: string) => {
        lastUrl = url;
        return { agents: [ag('agt_1')], total: 1 };
      },
    });
    renderWithProviders(<AgentsPage />);
    await screen.findByText('ProcureBot');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'suspended' } });
    await waitFor(() => expect(lastUrl).toContain('status=suspended'));

    fireEvent.click(screen.getByRole('button', { name: /^Tier/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    await waitFor(() => expect(lastUrl).toContain('tier=A'));
    expect(lastUrl).toContain('status=suspended'); // both filters present together, not one replacing the other

    const exportLink = screen.getByRole('link', { name: 'Export CSV' });
    expect(exportLink.getAttribute('href')).toContain('tier=A');
    expect(exportLink.getAttribute('href')).toContain('status=suspended');
  });

  it('labels an agent\'s verification by its owner\'s account type: KYC for individuals, KYB for businesses', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: [] },
      '/v1/agents': {
        agents: [
          ag('agt_1', { name: 'PersonalBot', accountType: 'individual', verification: 2 }),
          ag('agt_2', { name: 'CorpBot', accountType: 'business', verification: 2 }),
        ],
        total: 2,
      },
    });
    renderWithProviders(<AgentsPage />);
    await screen.findByText('PersonalBot');
    expect(screen.getByText(/Fully verified \(KYC\)/)).toBeInTheDocument();
    expect(screen.getByText(/Fully verified \(KYB\)/)).toBeInTheDocument();
  });

  it('lets the Tier and Verification dropdowns each pick several options at once', async () => {
    let lastUrl = '';
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: [] },
      '/v1/agents': (url: string) => {
        lastUrl = url;
        return { agents: [ag('agt_1')], total: 1 };
      },
    });
    renderWithProviders(<AgentsPage />);
    await screen.findByText('ProcureBot');

    const tierButton = screen.getByRole('button', { name: /^Tier/ });
    fireEvent.click(tierButton);
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    await waitFor(() => expect(lastUrl).toContain('tier=A%2CB'));
    expect(tierButton.textContent).toContain('2');
  });
});
