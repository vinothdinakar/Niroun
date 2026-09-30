'use client';

import { useEffect, useRef, useState } from 'react';
import { api, qs } from '../lib/api';
import { usd, when } from '../lib/format';
import { useSession } from '../lib/session';
import { useToast } from '../lib/toast';
import type { WalletSummary, WalletTx } from '../lib/types';
import { TX_STATUS, TX_TYPE_LABEL, txSign } from '../lib/wallet';
import { useLoaderShim } from './use-loader-shim';
import { DepositDialog, WithdrawDialog } from './wallet-dialogs';

const PAGE = 10;
type Filter = 'all' | 'deposit' | 'withdrawal';
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'deposit', label: 'Deposits' }, { id: 'withdrawal', label: 'Withdrawals' }];

// The organization's wallet: the balance, money in through Stripe and out through Stripe Connect, and every movement.
// Everyone in the organization can look; only the owner (wallet_manage) gets the buttons.
export function WalletView() {
  const { has } = useSession();
  const toast = useToast();
  const canManage = has('wallet_manage');
  const summary = useLoaderShim(() => api<WalletSummary>('GET', '/v1/console/wallet'), []);
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const txs = useLoaderShim(
    () => api<{ rows: WalletTx[]; total: number }>('GET', `/v1/console/wallet/transactions${qs({ type: filter === 'all' ? undefined : filter, page, pageSize: PAGE })}`),
    [filter, page],
  );
  const [dialog, setDialog] = useState<'deposit' | 'withdraw' | null>(null);
  const refresh = () => Promise.all([summary.reload(), txs.reload()]);

  // Back from Stripe: /organization?wallet=success&tx=... (deposit), =cancelled, =payouts (onboarding).
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.search);
    const back = params.get('wallet');
    if (!back) return;
    window.history.replaceState(null, '', `${window.location.pathname}#wallet`);
    void (async () => {
      if (back === 'success' && params.get('tx')) {
        try {
          const { transaction } = await api<{ transaction: WalletTx }>('POST', `/v1/console/wallet/deposits/${params.get('tx')}/sync`);
          toast(transaction.status === 'completed' ? 'Deposit received. It is in your wallet.' : 'Thanks. Your deposit is being processed and will show when it clears.');
        } catch {
          toast('We could not check your deposit yet. It will appear here when Stripe confirms it.', true);
        }
      } else if (back === 'cancelled') {
        toast('Deposit cancelled. Nothing was charged.');
      } else if (back === 'payouts' || back === 'payouts-retry') {
        toast(back === 'payouts' ? 'Welcome back. Checking your payout setup…' : 'Your payout setup was not finished. You can pick it up again.', back !== 'payouts');
      }
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setupPayouts() {
    try {
      window.location.assign((await api<{ url: string }>('POST', '/v1/console/wallet/payouts/setup')).url);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Something went wrong', true);
    }
  }

  if (summary.error) return <p className="form-error">{summary.error}</p>;
  if (!summary.data) return <p className="muted">Loading…</p>;
  const wallet = summary.data;
  if (!wallet.enabled) {
    return (
      <section className="panel pad">
        <h2 className="plain">Wallet</h2>
        <p className="muted">The wallet isn&apos;t available yet: payments aren&apos;t set up on this server.</p>
      </section>
    );
  }

  const { balance, payouts, limits } = wallet;
  const rows = txs.data?.rows ?? [];
  const total = txs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const onTheWay = balance.inTransitCents + balance.pendingDepositsCents;

  return (
    <div className="tab wallet">
      {wallet.testMode && <p className="callout" role="note"><span className="pill amber">Test mode</span> Money here is not real. Stripe&apos;s test cards and bank accounts work; nothing is charged.</p>}

      <section className="wallet-balances" aria-label="Balances">
        <div className="panel hero">
          <span className="muted">Available balance</span>
          <div className="big num" data-testid="available">{usd(balance.availableCents)}</div>
          {canManage ? (
            <div className="row-start">
              <button className="btn primary" type="button" onClick={() => setDialog('deposit')}>Deposit</button>
              <button className="btn" type="button" onClick={() => setDialog('withdraw')} disabled={balance.availableCents <= 0}>Withdraw</button>
            </div>
          ) : (
            <p className="muted small">Only your organization&apos;s owner can deposit or withdraw.</p>
          )}
        </div>
        <div className="panel stat">
          <span className="muted">Held for open deals</span>
          <div className="mid num">{usd(balance.heldCents)}</div>
          <p className="muted small">Money reserved for open deals shows here. It can&apos;t be withdrawn until they settle.</p>
        </div>
        <div className="panel stat">
          <span className="muted">On the way</span>
          <div className="mid num">{usd(onTheWay)}</div>
          <p className="muted small">
            {balance.inTransitCents > 0 && <>{usd(balance.inTransitCents)} heading to your bank. </>}
            {balance.pendingDepositsCents > 0 && <>{usd(balance.pendingDepositsCents)} of deposits still clearing.</>}
            {onTheWay === 0 && 'Withdrawals and deposits in progress show here.'}
          </p>
        </div>
      </section>

      <div className="wallet-grid">
        <section className="panel" aria-label="Transactions">
          <div className="tx-head">
            <h2 className="plain">Transactions</h2>
            <div className="chips" role="group" aria-label="Filter transactions">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" className={`chip${filter === f.id ? ' on' : ''}`} aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setPage(1); }}>{f.label}</button>
              ))}
            </div>
          </div>
          {txs.error ? <p className="form-error pad">{txs.error}</p> : rows.length === 0 && txs.data ? (
            <div className="empty-state">
              <h3>No transactions yet</h3>
              <p className="muted">Deposits, withdrawals and money held for deals show up here, with their status and your balance after each one.</p>
              {canManage && filter === 'all' && <button className="btn primary" type="button" onClick={() => setDialog('deposit')}>Make your first deposit</button>}
            </div>
          ) : (
            <table className="tx-table">
              <thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Status</th><th className="num">Amount</th><th className="num">Balance</th></tr></thead>
              <tbody>
                {rows.map((t) => {
                  const [label, color] = TX_STATUS[t.status];
                  const dead = t.status === 'failed' || t.status === 'canceled';
                  return (
                    <tr key={t.id}>
                      <td className="muted">{when(t.createdAt)}</td>
                      <td>{TX_TYPE_LABEL[t.type]}</td>
                      <td>{t.description}{t.failureReason && <div className="muted small">{t.failureReason}</div>}</td>
                      <td><span className={`pill ${color}`}>{label}</span></td>
                      <td className={`num${dead ? ' struck muted' : txSign(t) > 0 ? ' pos' : ''}`}>{txSign(t) > 0 ? '+' : '−'}{usd(t.amountCents)}</td>
                      <td className="num">{t.balanceAfterCents === null ? '—' : usd(t.balanceAfterCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {total > PAGE && (
            <div className="pager">
              <span className="muted small">Page {page} of {pages} ({total} total)</span>
              <button className="btn ghost sm" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
              <button className="btn ghost sm" type="button" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          )}
        </section>

        <aside className="wallet-side" aria-label="Payouts and limits">
          <section className="panel pad">
            <h2 className="plain">Payouts</h2>
            {payouts.status === 'ready' ? (
              <>
                <p><span className="pill green">Ready</span></p>
                <p className="muted small">Withdrawals go to {payouts.bank?.name ? `${payouts.bank.name} ` : 'your bank account '}{payouts.bank?.last4 ? `•••• ${payouts.bank.last4}` : ''}, verified with Stripe.</p>
              </>
            ) : (
              <>
                <p><span className={`pill ${payouts.status === 'incomplete' ? 'amber' : 'gray'}`}>{payouts.status === 'incomplete' ? 'Setup unfinished' : 'Not set up'}</span></p>
                <p className="muted small">To withdraw, add a bank account and confirm who you are with Stripe. It takes about five minutes, once. You can deposit meanwhile.</p>
                {canManage && <button className="btn primary sm" type="button" onClick={() => void setupPayouts()}>{payouts.status === 'incomplete' ? 'Continue setup on Stripe' : 'Set up payouts on Stripe'}</button>}
              </>
            )}
          </section>
          <section className="panel pad">
            <h2 className="plain">Daily limits</h2>
            <Limit label="Deposits" used={limits.usedDepositCents} max={limits.dailyDepositCents} />
            <Limit label="Withdrawals" used={limits.usedWithdrawalCents} max={limits.dailyWithdrawalCents} />
            <p className="muted small">Withdrawals ask for your two-step code.</p>
          </section>
        </aside>
      </div>

      <DepositDialog open={dialog === 'deposit'} onClose={() => setDialog(null)} wallet={wallet} />
      <WithdrawDialog open={dialog === 'withdraw'} onClose={() => setDialog(null)} wallet={wallet} onDone={() => void refresh()} />
    </div>
  );
}

function Limit({ label, used, max }: { label: string; used: number; max: number }) {
  return (
    <div className="limit">
      <div className="limit-row"><span>{label}</span><span className="muted num">{usd(used).replace('.00', '')} of {usd(max).replace('.00', '')}</span></div>
      <div className="limit-bar" role="progressbar" aria-label={`${label} used today`} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}><i style={{ width: `${Math.min(100, (used / max) * 100)}%` }} /></div>
    </div>
  );
}
