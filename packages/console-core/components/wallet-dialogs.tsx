'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../lib/api';
import { usd } from '../lib/format';
import { useToast } from '../lib/toast';
import { DepositMethod, parseDollars, quoteDeposit } from '../lib/wallet';
import { Modal } from './modal';

type Ready = Extract<import('../lib/types').WalletSummary, { enabled: true }>;

const QUICK = [50_000, 100_000, 500_000, 1_000_000];
const dollarsText = (cents: number) => (cents / 100).toFixed(2);

// Each dialog's form is mounted only while open, so it starts fresh (and forgets a typed code) every time.
export function DepositDialog({ open, onClose, wallet }: { open: boolean; onClose: () => void; wallet: Ready }) {
  return <Modal open={open} onClose={onClose}><DepositForm onClose={onClose} wallet={wallet} /></Modal>;
}

function DepositForm({ onClose, wallet }: { onClose: () => void; wallet: Ready }) {
  const [text, setText] = useState('1000.00');
  const [method, setMethod] = useState<DepositMethod>('card');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = parseDollars(text);
  const { limits } = wallet;
  const remaining = Math.max(0, limits.dailyDepositCents - limits.usedDepositCents);
  const problem =
    cents === null ? 'Enter an amount in dollars.'
      : cents < limits.minCents ? `The minimum is ${usd(limits.minCents)}.`
        : cents > limits.maxDepositCents ? `The most you can deposit at once is ${usd(limits.maxDepositCents)}.`
          : cents > remaining ? `You can deposit ${usd(remaining)} more today.` : '';
  const quote = cents !== null && !problem ? quoteDeposit(method, cents) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (cents === null || problem) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ id: string; url: string }>('POST', '/v1/console/wallet/deposits', { amountCents: cents, method });
      window.location.assign(r.url); // Stripe's page: the card or bank details are never typed into Bond
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="wallet-dialog">
      <h3>Deposit funds</h3>
      <p className="muted small">Add money to your organization&apos;s wallet.</p>
      <label htmlFor="dep-amount">Amount (USD)</label>
      <div className="money-input">
        <span aria-hidden="true">$</span>
        <input id="dep-amount" inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!problem} />
      </div>
      <div className="chips" role="group" aria-label="Quick amounts">
        {QUICK.map((q) => (
          <button key={q} type="button" className={`chip${cents === q ? ' on' : ''}`} onClick={() => setText(dollarsText(q))}>{usd(q).replace('.00', '')}</button>
        ))}
      </div>
      {problem && text.trim() !== '' && <p className="form-error" role="alert">{problem}</p>}

      <fieldset className="method-list">
        <legend>Pay with</legend>
        <label className={`method-opt${method === 'card' ? ' on' : ''}`}>
          <input type="radio" name="dep-method" checked={method === 'card'} onChange={() => setMethod('card')} />
          <span><b>Card</b><br /><span className="muted small">Instant · 2.9% + 30¢</span></span>
          <span className="num">{cents !== null && !problem ? usd(quoteDeposit('card', cents).feeCents) : ''}</span>
        </label>
        <label className={`method-opt${method === 'ach' ? ' on' : ''}`}>
          <input type="radio" name="dep-method" checked={method === 'ach'} onChange={() => setMethod('ach')} />
          <span><b>Bank transfer (ACH)</b><br /><span className="muted small">3–5 business days · 0.8%, capped at $5</span></span>
          <span className="num">{cents !== null && !problem ? usd(quoteDeposit('ach', cents).feeCents) : ''}</span>
        </label>
      </fieldset>

      <dl className="sums">
        <div><dt className="muted">Deposit</dt><dd className="num">{quote && cents !== null ? usd(cents) : '—'}</dd></div>
        <div><dt className="muted">Processing fee</dt><dd className="num">{quote ? usd(quote.feeCents) : '—'}</dd></div>
        <div className="total"><dt>You&apos;ll be charged</dt><dd className="num">{quote ? usd(quote.chargeCents) : '—'}</dd></div>
      </dl>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row-end">
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy || !quote}>{busy ? 'Opening Stripe…' : 'Continue to Stripe'}</button>
      </div>
      <p className="muted small">You&apos;ll confirm on Stripe&apos;s secure page. Bond never sees your card or bank details.{wallet.testMode && ' Test mode: use card 4242 4242 4242 4242.'}</p>
    </form>
  );
}

export function WithdrawDialog({ open, onClose, wallet, onDone }: { open: boolean; onClose: () => void; wallet: Ready; onDone: () => void }) {
  return <Modal open={open} onClose={onClose}><WithdrawForm onClose={onClose} wallet={wallet} onDone={onDone} /></Modal>;
}

function WithdrawForm({ onClose, wallet, onDone }: { onClose: () => void; wallet: Ready; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { balance, limits, payouts } = wallet;
  const cents = parseDollars(text);
  const remaining = Math.max(0, limits.dailyWithdrawalCents - limits.usedWithdrawalCents);
  const blocker = payouts.status !== 'ready' ? 'payouts' : !wallet.twoStepEnabled ? 'two-step' : null;
  const problem =
    cents === null ? ''
      : cents < limits.minCents ? `The minimum is ${usd(limits.minCents)}.`
        : cents > balance.availableCents ? 'That is more than your available balance.'
          : cents > remaining ? `You can withdraw ${usd(remaining)} more today.` : '';
  const ok = cents !== null && !problem && /^\d{6}$/.test(code);

  async function startSetup() {
    try {
      window.location.assign((await api<{ url: string }>('POST', '/v1/console/wallet/payouts/setup')).url);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ok || cents === null) return;
    setBusy(true);
    setError('');
    try {
      await api('POST', '/v1/console/wallet/withdrawals', { amountCents: cents, code });
      toast(`Withdrawal of ${usd(cents)} started`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="wallet-dialog">
      <h3>Withdraw funds</h3>
      <p className="muted small">Send money from your wallet to your bank account.</p>
      {blocker === 'payouts' && (
        <div className="callout">
          <p>Set up payouts with Stripe before you withdraw. It takes about five minutes, once.</p>
          <button className="btn primary sm" type="button" onClick={() => void startSetup()}>{payouts.status === 'incomplete' ? 'Continue setup on Stripe' : 'Set up payouts on Stripe'}</button>
        </div>
      )}
      {blocker === 'two-step' && (
        <div className="callout">
          <p>Withdrawals need two-step verification. <Link href="/account#two-step">Turn it on in your account</Link>, then come back.</p>
        </div>
      )}
      {!blocker && (
        <>
          <div className="label-row"><label htmlFor="wd-amount">Amount (USD)</label><span className="muted small">Available <b className="num">{usd(balance.availableCents)}</b></span></div>
          <div className="money-input">
            <span aria-hidden="true">$</span>
            <input id="wd-amount" inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="0.00" aria-invalid={!!problem} />
            <button type="button" className="chip" onClick={() => setText(dollarsText(Math.min(balance.availableCents, remaining)))}>Max</button>
          </div>
          {problem && <p className="form-error" role="alert">{problem}</p>}
          <p className="muted small">Money reserved for open deals can&apos;t be withdrawn. Limit today: {usd(remaining)} left.</p>

          <div className="dest">
            <b>Bank account {payouts.bank?.last4 ? `•••• ${payouts.bank.last4}` : ''}</b>
            <span className="muted small">{payouts.bank?.name ? `${payouts.bank.name} · ` : ''}Verified with Stripe · arrives in 1–2 business days</span>
          </div>
          <dl className="sums">
            <div><dt className="muted">Fee</dt><dd className="num">{usd(0)}</dd></div>
            <div className="total"><dt>You&apos;ll receive</dt><dd className="num">{cents !== null && !problem ? usd(cents) : '—'}</dd></div>
          </dl>

          <label htmlFor="wd-code">Two-step code</label>
          <input id="wd-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="6-digit code from your authenticator" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
        </>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="row-end">
        <button className="btn ghost" type="button" onClick={onClose}>Cancel</button>
        {!blocker && <button className="btn primary" type="submit" disabled={busy || !ok}>{busy ? 'Withdrawing…' : cents !== null && !problem ? `Withdraw ${usd(cents)}` : 'Withdraw'}</button>}
      </div>
    </form>
  );
}
