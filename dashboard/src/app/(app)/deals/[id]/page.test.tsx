import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import { DealDetailView } from '@bond/console-core/components/deal-detail-view';

const baseUser = {
  id: 'usr_1', email: 'ada@bond.test', name: 'Ada Owner', orgId: 'org_1', orgName: 'Acme Corp',
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off' as const, recoveryCodesLeft: null,
};

// 45 events, well past the 40-row cap the agent drawer's own ledger view uses — the deal timeline must not truncate.
const events = Array.from({ length: 45 }, (_, i) => ({
  seq: i, agentId: i % 2 === 0 ? 'agt_buyer' : 'agt_seller', type: `event_${i}`, data: {}, ts: i, hash: `h${i}`,
}));

const resolvedDispute = {
  id: 'dp_1', reason: 'nothing arrived', openedAt: 100,
  status: 'resolved' as const, verdict: 'seller_fault', rule: 'NON_DELIVERY',
  reasons: ['No delivery recorded by the deadline.'], decidedBy: 'auto' as const, resolvedAt: 200,
};

const fullTx = (overrides: Record<string, unknown> = {}) => ({
  id: 'tx_1', status: 'funded', category: 'data',
  buyerId: 'agt_buyer', buyerName: 'Buyer', buyerOrgId: 'org_1',
  sellerId: 'agt_seller', sellerName: 'Seller', sellerOrgId: 'org_2',
  amountCents: 5000, coverageCents: 5000, premiumCents: 250, payoutCents: 0, createdAt: 0, updatedAt: 0, deliverBy: 0, disputeId: null,
  terms: { spec: 'Widget x10', priceCents: 5000, deliverBy: 0 }, termsHash: 'h', events, dispute: null,
  ...overrides,
});

describe('DealDetailView', () => {
  it('renders the full, uncapped timeline and labels each event Buyer or Seller', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: [] },
      '/v1/transactions/tx_1': fullTx(),
    });
    renderWithProviders(<DealDetailView id="tx_1" />);
    await screen.findByText('event_0');

    expect(screen.getByText(/45 events/)).toBeInTheDocument();
    expect(screen.getByText('event_44')).toBeInTheDocument(); // the 41st+ event — proves no 40-row cap
    expect(screen.getAllByText('Buyer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Seller').length).toBeGreaterThan(0);
  });

  it('shows "Open a dispute" only to the buyer\'s own org, with the permission, on an eligible deal', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: ['agents_manage'] },
      '/v1/transactions/tx_1': fullTx(),
    });
    renderWithProviders(<DealDetailView id="tx_1" />);
    await screen.findByText('event_0');
    expect(screen.getByRole('button', { name: 'Open a dispute' })).toBeInTheDocument();
  });

  it('hides it for the seller\'s own org (buyerOrgId does not match)', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, orgId: 'org_2', role: 'owner_admin' }, permissions: ['agents_manage'] },
      '/v1/transactions/tx_1': fullTx(),
    });
    renderWithProviders(<DealDetailView id="tx_1" />);
    await screen.findByText('event_0');
    expect(screen.queryByRole('button', { name: 'Open a dispute' })).not.toBeInTheDocument();
  });

  it('hides it without the agents_manage permission (e.g. an owner_viewer)', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_viewer' }, permissions: [] },
      '/v1/transactions/tx_1': fullTx(),
    });
    renderWithProviders(<DealDetailView id="tx_1" />);
    await screen.findByText('event_0');
    expect(screen.queryByRole('button', { name: 'Open a dispute' })).not.toBeInTheDocument();
  });

  it('hides it once the deal already has a dispute', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: ['agents_manage'] },
      '/v1/transactions/tx_1': fullTx({ disputeId: 'dp_1', dispute: resolvedDispute }),
    });
    renderWithProviders(<DealDetailView id="tx_1" />);
    await screen.findByText('event_0');
    expect(screen.queryByRole('button', { name: 'Open a dispute' })).not.toBeInTheDocument();
  });

  it('shows the resolved dispute\'s verdict, rule, reasons and who decided it', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: [] },
      '/v1/transactions/tx_1': fullTx({ status: 'resolved_seller_fault', disputeId: 'dp_1', dispute: resolvedDispute }),
    });
    renderWithProviders(<DealDetailView id="tx_1" />);
    await screen.findByText('event_0');

    expect(screen.getByText('Seller at fault')).toBeInTheDocument();
    expect(screen.getByText('NON_DELIVERY')).toBeInTheDocument();
    expect(screen.getByText('"nothing arrived"')).toBeInTheDocument();
    expect(screen.getByText(/No delivery recorded/)).toBeInTheDocument();
    expect(screen.getByText("Bond's arbiter")).toBeInTheDocument();
  });

  it('shows a needs-review dispute distinctly from a resolved one', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: [] },
      '/v1/transactions/tx_1': fullTx({
        status: 'disputed', disputeId: 'dp_2',
        dispute: { id: 'dp_2', reason: 'wrong item', openedAt: 0, status: 'needs_review', verdict: null, rule: null, reasons: [], decidedBy: null, resolvedAt: null },
      }),
    });
    renderWithProviders(<DealDetailView id="tx_1" />);
    await screen.findByText('event_0');
    expect(screen.getByText('Needs human review')).toBeInTheDocument();
  });

  it('shows it to staff regardless of org', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, orgId: null, role: 'admin' }, permissions: ['agents_manage'] },
      '/v1/transactions/tx_1': fullTx(),
    });
    renderWithProviders(<DealDetailView id="tx_1" />);
    await screen.findByText('event_0');
    expect(screen.getByRole('button', { name: 'Open a dispute' })).toBeInTheDocument();
  });

  it('submits the reason to the console endpoint and refreshes the deal on success', async () => {
    const openDispute = vi.fn(async (_url: string, _init?: RequestInit) => ({ dispute: { id: 'dp_1', verdict: 'seller_fault', status: 'resolved' } }));
    let txCallCount = 0;
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: ['agents_manage'] },
      '/v1/transactions/tx_1': () => { txCallCount++; return fullTx(txCallCount > 1 ? { disputeId: 'dp_1', status: 'resolved_seller_fault' } : {}); },
      '/v1/console/transactions/tx_1/disputes': openDispute,
    });
    renderWithProviders(<DealDetailView id="tx_1" />);
    await screen.findByText('event_0');

    fireEvent.click(screen.getByRole('button', { name: 'Open a dispute' }));
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'nothing arrived' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open dispute' }));

    await waitFor(() => expect(openDispute).toHaveBeenCalled());
    expect(openDispute.mock.calls[0][1]).toMatchObject({ body: JSON.stringify({ reason: 'nothing arrived' }) });
    await waitFor(() => expect(txCallCount).toBeGreaterThan(1)); // reloaded the deal after opening
  });
});
