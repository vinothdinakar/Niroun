import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import { WalletView } from '@bond/console-core/components/wallet-view';

// jsdom has no modal <dialog>; a minimal one is enough for what these tests look at.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});
afterEach(() => { window.history.replaceState(null, '', '/'); });

const owner = { id: 'usr_1', email: 'ada@acme.test', name: 'Ada', orgId: 'org_1', orgName: 'Acme', role: 'owner_admin' as const, disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'enabled' as const, recoveryCodesLeft: 5 };
const viewer = { ...owner, role: 'owner_viewer' as const };

const summary = (over: Record<string, unknown> = {}) => ({
  enabled: true, testMode: true,
  balance: { availableCents: 1_248_000, heldCents: 0, inTransitCents: 150_000, pendingDepositsCents: 0 },
  payouts: { status: 'ready', bank: { last4: '6789', name: 'Test Bank' } },
  limits: { minCents: 1000, maxDepositCents: 2_500_000, dailyDepositCents: 2_500_000, usedDepositCents: 500_000, dailyWithdrawalCents: 1_000_000, usedWithdrawalCents: 150_000 },
  twoStepEnabled: true, ...over,
});
const tx = (over: Record<string, unknown> = {}) => ({
  id: 'wtx_1', type: 'deposit', status: 'completed', amountCents: 500_000, feeCents: 0, chargeCents: 500_000, method: 'card',
  description: 'Deposit by card', createdAt: Date.UTC(2026, 8, 30, 9, 12), balanceAfterCents: 1_248_000, ...over,
});
const manage = ['wallet_manage'];

function boot(over: { me?: unknown; perms?: string[]; summary?: unknown; rows?: unknown[]; extra?: Record<string, unknown> } = {}) {
  return mockApi({
    '/v1/auth/me': { user: over.me ?? owner, permissions: over.perms ?? manage },
    '/v1/console/wallet': over.summary ?? summary(),
    '/v1/console/wallet/transactions': { rows: over.rows ?? [tx()], total: (over.rows ?? [tx()]).length },
    ...(over.extra ?? {}),
  });
}

describe('WalletView', () => {
  it('says so when payments are not set up on the server', async () => {
    boot({ summary: { enabled: false } });
    renderWithProviders(<WalletView />);
    expect(await screen.findByText(/isn.t available yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deposit' })).not.toBeInTheDocument();
  });

  it('shows the balances, the payout state and the transactions, with test mode flagged', async () => {
    boot({ rows: [tx(), tx({ id: 'wtx_2', type: 'withdrawal', status: 'processing', amountCents: 150_000, description: 'Withdrawal to bank account •••• 6789', balanceAfterCents: 748_000 }), tx({ id: 'wtx_3', type: 'withdrawal', status: 'failed', amountCents: 50_000, failureReason: 'Account closed' })] });
    renderWithProviders(<WalletView />);
    expect(await screen.findByTestId('available')).toHaveTextContent('$12,480.00');
    expect(screen.getByText('Test mode')).toBeInTheDocument();
    expect(screen.getByText(/\$1,500\.00 heading to your bank/)).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText(/•••• 6789, verified/)).toBeInTheDocument();
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Completed')).toHaveClass('green');
    expect(within(rows[0]).getByText('+$5,000.00')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Processing')).toHaveClass('amber');
    expect(within(rows[1]).getByText('−$1,500.00')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Failed')).toHaveClass('red');
    expect(within(rows[2]).getByText('Account closed')).toBeInTheDocument();
  });

  it('gives a viewer the numbers but no buttons that move money', async () => {
    boot({ me: viewer, perms: [] });
    renderWithProviders(<WalletView />);
    expect(await screen.findByTestId('available')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deposit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only your organization.s owner can deposit or withdraw/)).toBeInTheDocument();
  });

  it('filters and pages the transactions through the API', async () => {
    const fetchMock = boot();
    renderWithProviders(<WalletView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdrawals' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/transactions?type=withdrawal'))).toBe(true));
    expect(screen.getByRole('button', { name: 'Withdrawals' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a first-time empty state that points at a first deposit', async () => {
    boot({ rows: [], summary: summary({ balance: { availableCents: 0, heldCents: 0, inTransitCents: 0, pendingDepositsCents: 0 }, payouts: { status: 'not_setup', bank: null } }) });
    renderWithProviders(<WalletView />);
    expect(await screen.findByText('No transactions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make your first deposit' })).toBeInTheDocument();
    expect(screen.getByText('Not set up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set up payouts on Stripe' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeDisabled(); // nothing to withdraw
  });

  it('deposit dialog: shows the fee and total as you type, then sends you to Stripe', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, search: '', pathname: '/organization' });
    const fetchMock = boot({ extra: { '/v1/console/wallet/deposits': { id: 'wtx_9', url: 'https://checkout.stripe.test/cs_1' } } });
    renderWithProviders(<WalletView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deposit' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Amount (USD)'), { target: { value: '5000' } });
    // card: 2.9% + 30c, paid by the customer so the wallet gets the full $5,000
    expect(within(dialog).getByText('$5,149.64')).toBeInTheDocument();
    expect(within(dialog).getByText('$149.64', { selector: 'dd' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByLabelText(/Bank transfer/));
    expect(within(dialog).getByText('$5,005.00')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue to Stripe' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/cs_1'));
    const post = fetchMock.mock.calls.find(([u, init]) => String(u) === '/v1/console/wallet/deposits' && init?.method === 'POST')!;
    expect(JSON.parse(String(post[1]?.body))).toEqual({ amountCents: 500_000, method: 'ach' });
  });

  it('deposit dialog: refuses amounts that are too small, too large or over the day\'s limit', async () => {
    boot();
    renderWithProviders(<WalletView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deposit' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Amount (USD)');
    const go = within(dialog).getByRole('button', { name: 'Continue to Stripe' });
    fireEvent.change(amount, { target: { value: '5' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('The minimum is $10.00');
    expect(go).toBeDisabled();
    fireEvent.change(amount, { target: { value: '30000' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('$25,000.00');
    fireEvent.change(amount, { target: { value: '21000' } }); // $5,000 of the $25,000 day is already used
    expect(within(dialog).getByRole('alert')).toHaveTextContent('You can deposit $20,000.00 more today');
    fireEvent.change(amount, { target: { value: 'abc' } });
    expect(go).toBeDisabled();
    fireEvent.change(amount, { target: { value: '2,000.50' } });
    expect(go).not.toBeDisabled();
  });

  it('withdraw dialog: needs payouts set up, and offers to start that', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, search: '', pathname: '/organization' });
    boot({ summary: summary({ payouts: { status: 'incomplete', bank: null } }), extra: { '/v1/console/wallet/payouts/setup': { url: 'https://connect.stripe.test/onboard/1' } } });
    renderWithProviders(<WalletView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Two-step code')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue setup on Stripe' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://connect.stripe.test/onboard/1'));
  });

  it('withdraw dialog: needs two-step verification turned on', async () => {
    boot({ summary: summary({ twoStepEnabled: false }) });
    renderWithProviders(<WalletView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('link', { name: /Turn it on in your account/ })).toHaveAttribute('href', '/account#two-step');
    expect(within(dialog).queryByLabelText('Two-step code')).not.toBeInTheDocument();
  });

  it('withdraw dialog: checks the amount against the balance, asks for the code, and sends both', async () => {
    const fetchMock = boot({ extra: { '/v1/console/wallet/withdrawals': { transaction: tx({ id: 'wtx_5', type: 'withdrawal', status: 'processing' }) } } });
    renderWithProviders(<WalletView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Amount (USD)');
    const code = within(dialog).getByLabelText('Two-step code');
    const go = () => within(dialog).getByRole('button', { name: /^Withdraw/ });
    expect(go()).toBeDisabled();
    fireEvent.change(amount, { target: { value: '99999' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('more than your available balance');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Max' }));
    expect(amount).toHaveValue('8500.00'); // the day's limit ($10,000 less $1,500 used) is lower than the balance
    fireEvent.change(amount, { target: { value: '2000' } });
    fireEvent.change(code, { target: { value: '12ab34' } }); // only digits stay
    expect(code).toHaveValue('1234');
    expect(go()).toBeDisabled();
    fireEvent.change(code, { target: { value: '123456' } });
    expect(go()).toHaveTextContent('Withdraw $2,000.00');
    fireEvent.click(go());
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u, init]) => String(u) === '/v1/console/wallet/withdrawals' && init?.method === 'POST');
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ amountCents: 200_000, code: '123456' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { hidden: false })).not.toBeInTheDocument());
  });

  it('coming back from Stripe checks the deposit right away and tells the person', async () => {
    window.history.replaceState(null, '', '/organization?wallet=success&tx=wtx_7');
    const fetchMock = boot({ extra: { '/v1/console/wallet/deposits/wtx_7/sync': { transaction: tx({ id: 'wtx_7' }) } } });
    renderWithProviders(<WalletView />);
    await waitFor(() => expect(fetchMock.mock.calls.some(([u, init]) => String(u) === '/v1/console/wallet/deposits/wtx_7/sync' && init?.method === 'POST')).toBe(true));
    expect(await screen.findByText(/Deposit received/)).toBeInTheDocument();
    expect(window.location.search).toBe(''); // the return marker is cleared from the address
  });
});
