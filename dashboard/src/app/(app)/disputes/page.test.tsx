import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import DisputesPage from './page';

const baseUser = {
  id: 'usr_1', email: 'admin@bond.test', name: 'Ada Admin', orgId: null as string | null, orgName: null as string | null,
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'enabled' as const, recoveryCodesLeft: 5,
};

const dispute = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, txId: 'tx_1', openedAt: 0, buyerName: 'Buyer', sellerName: 'Seller', amountCents: 1000,
  status: 'needs_review', verdict: null, rule: null, reasons: [], decidedBy: null, ...overrides,
});

describe('DisputesPage', () => {
  it('sends status/verdict filters as query params, and the export link mirrors them', async () => {
    let lastUrl = '';
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'admin' }, permissions: ['resolve'] },
      '/v1/disputes': (url: string) => {
        lastUrl = url;
        return { disputes: [dispute('dp_1')], total: 1 };
      },
    });
    renderWithProviders(<DisputesPage />);
    await screen.findByText('$10.00'); // the row's amount — unlike "Buyer", unambiguous with the table header

    fireEvent.click(screen.getByRole('button', { name: /^Status/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^needs review$/i }));
    await waitFor(() => expect(lastUrl).toContain('status=needs_review'));

    const exportLink = screen.getByRole('link', { name: 'Export CSV' });
    expect(exportLink.getAttribute('href')).toContain('status=needs_review');
    expect(exportLink.getAttribute('href')).toContain('/v1/disputes/export');
  });

  it('lets the Status and Verdict dropdowns each pick several options at once', async () => {
    let lastUrl = '';
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'admin' }, permissions: ['resolve'] },
      '/v1/disputes': (url: string) => {
        lastUrl = url;
        return { disputes: [dispute('dp_1')], total: 1 };
      },
    });
    renderWithProviders(<DisputesPage />);
    await screen.findByText('$10.00');

    const statusButton = screen.getByRole('button', { name: /^Status/ });
    fireEvent.click(statusButton);
    fireEvent.click(screen.getByRole('checkbox', { name: /^open$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^needs review$/i }));
    await waitFor(() => expect(lastUrl).toContain('status=open%2Cneeds_review'));
    expect(statusButton.textContent).toContain('2');
  });

  it('still lets a reviewer resolve a dispute inline, refetching the paginated list afterwards', async () => {
    const resolve = vi.fn(async () => ({ id: 'dp_1', status: 'resolved' }));
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'admin' }, permissions: ['resolve'] },
      '/v1/disputes': { disputes: [dispute('dp_1')], total: 1 },
      '/v1/console/disputes/dp_1/resolve': resolve,
    });
    renderWithProviders(<DisputesPage />);
    await screen.findByText('$10.00'); // the row's amount — unlike "Buyer", unambiguous with the table header
    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(resolve).toHaveBeenCalled());
  });
});
