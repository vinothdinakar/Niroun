import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import DealsPage from './page';

const baseUser = {
  id: 'usr_1', email: 'ada@bond.test', name: 'Ada Owner', orgId: 'org_1', orgName: 'Acme Corp',
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off' as const, recoveryCodesLeft: null,
};

const tx = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, status: 'funded', category: 'data', buyerId: 'agt_b', buyerName: 'Buyer', sellerId: 'agt_s', sellerName: 'Seller',
  amountCents: 1000, premiumCents: 50, payoutCents: 0, createdAt: 0, updatedAt: 0, deliverBy: 0, disputeId: null, ...overrides,
});

describe('DealsPage', () => {
  it('sends the current filters as query params, and the export link mirrors them', async () => {
    let lastUrl = '';
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: [] },
      '/v1/transactions': (url: string) => {
        lastUrl = url;
        return { transactions: [tx('tx_1')], total: 1 };
      },
    });
    renderWithProviders(<DealsPage />);
    await screen.findByText('$10.00'); // the row's amount — unlike "Buyer", unambiguous with the table header

    fireEvent.change(screen.getByPlaceholderText(/Search by agent name/i), { target: { value: 'Seller' } });
    await waitFor(() => expect(lastUrl).toContain('search=Seller'));

    const exportLink = screen.getByRole('link', { name: 'Export CSV' });
    expect(exportLink.getAttribute('href')).toContain('search=Seller');
    expect(exportLink.getAttribute('href')).toContain('/v1/transactions/export');
  });

  it('lets the Status dropdown pick several options at once', async () => {
    let lastUrl = '';
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: [] },
      '/v1/transactions': (url: string) => {
        lastUrl = url;
        return { transactions: [tx('tx_1')], total: 1 };
      },
    });
    renderWithProviders(<DealsPage />);
    await screen.findByText('$10.00');

    const statusButton = screen.getByRole('button', { name: /^Status/ });
    fireEvent.click(statusButton);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fulfilled' }));
    await waitFor(() => expect(lastUrl).toContain('status=fulfilled'));

    // the dropdown stays open across selections, letting a second option be picked in the same click
    fireEvent.click(screen.getByRole('checkbox', { name: 'Paid out' }));
    await waitFor(() => expect(lastUrl).toContain('status=fulfilled%2Cresolved_seller_fault'));
    expect(statusButton.textContent).toContain('2');
  });

  it('links each row to its deal detail page', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: [] },
      '/v1/transactions': { transactions: [tx('tx_42')], total: 1 },
    });
    const { container } = renderWithProviders(<DealsPage />);
    await screen.findByText('$10.00');
    expect(container.querySelector('a[href="/deals/tx_42"]')).toBeTruthy();
  });
});
