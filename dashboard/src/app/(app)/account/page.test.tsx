import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import AccountPage from './page';

const user = (over: Record<string, unknown> = {}) => ({
  id: 'usr_1', email: 'ada@acme.test', name: 'Ada Owner', legalFirstName: null, legalLastName: null,
  role: 'owner_admin', orgId: 'org_1', orgName: 'Acme Corp',
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off', recoveryCodesLeft: null,
  emailVerified: false, phone: null, phoneVerified: false, ...over,
});

afterEach(() => { window.location.hash = ''; });

describe('AccountPage', () => {
  it('shows who you are, with a menu of sections opening on Profile', async () => {
    mockApi({ '/v1/auth/me': { user: user(), permissions: [] } });
    renderWithProviders(<AccountPage />);
    expect(await screen.findByLabelText('Legal first name')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument(); // the name isn't edited on this page
    expect(screen.getAllByText('ada@acme.test').length).toBeGreaterThan(0); // once in the hero, once in the Email row
    expect(screen.getByText('AO')).toBeInTheDocument();
    expect(screen.getByText('Organization owner')).toHaveClass('pill');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Profile', 'Password', 'Two-step verification', 'Active sessions']);
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not tell an org owner that someone invited them, or show a fixed-account note', async () => {
    mockApi({ '/v1/auth/me': { user: user(), permissions: [] } });
    renderWithProviders(<AccountPage />);
    await screen.findByLabelText('Legal first name');
    expect(screen.queryByText(/whoever invited you/)).not.toBeInTheDocument();
    expect(screen.queryByText(/email and role are fixed/)).not.toBeInTheDocument();
  });

  it('tells a viewer to ask their organization\'s admins', async () => {
    mockApi({ '/v1/auth/me': { user: user({ role: 'owner_viewer' }), permissions: [] } });
    renderWithProviders(<AccountPage />);
    await screen.findByLabelText('Legal first name');
    expect(screen.getByText(/Ask one of them/)).toBeInTheDocument();
  });

  it('shows the selected section on the right and keeps the choice in the address', async () => {
    mockApi({ '/v1/auth/me': { user: user(), permissions: [] } });
    renderWithProviders(<AccountPage />);
    await screen.findByLabelText('Legal first name');
    fireEvent.click(screen.getByRole('tab', { name: 'Password' }));
    expect(await screen.findByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Legal first name')).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#password');
  });

  it('changes the password with a form on the page itself, not in a popup', async () => {
    window.location.hash = '#password';
    const fetchMock = mockApi({ '/v1/auth/me': { user: user(), permissions: [] }, '/v1/auth/change-password': { ok: true } });
    renderWithProviders(<AccountPage />);
    const submit = await screen.findByRole('button', { name: 'Change password' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-password-123' } });
    fireEvent.change(screen.getByLabelText('New password (12+ characters)'), { target: { value: 'a-brand-new-password' } });
    fireEvent.click(submit);
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u]) => String(u) === '/v1/auth/change-password');
      expect(JSON.parse(String(post?.[1]?.body))).toEqual({ current: 'old-password-123', next: 'a-brand-new-password' });
    });
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''));
  });

  it('opens straight to a section named in the address, and reports two-step status', async () => {
    window.location.hash = '#two-step';
    mockApi({ '/v1/auth/me': { user: user({ mfa: 'enabled', recoveryCodesLeft: 7 }), permissions: [] } });
    renderWithProviders(<AccountPage />);
    expect(await screen.findByText('On')).toHaveClass('pill', 'green');
    expect(screen.getByText(/7 left/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate new codes' })).toBeInTheDocument();
  });

  it('hides recovery codes when two-step verification is off', async () => {
    window.location.hash = '#two-step';
    mockApi({ '/v1/auth/me': { user: user(), permissions: [] } });
    renderWithProviders(<AccountPage />);
    expect(await screen.findByText('Off')).toBeInTheDocument();
    expect(screen.queryByText('Recovery codes')).not.toBeInTheDocument();
  });

  it('saves the legal name through PUT /v1/auth/me, sending the current name unchanged', async () => {
    const fetchMock = mockApi({
      '/v1/auth/me': (_url: string, init?: RequestInit) =>
        init?.method === 'PUT'
          ? { user: user({ legalFirstName: 'Ada', legalLastName: 'Lovelace' }), permissions: [] }
          : { user: user(), permissions: [] },
    });
    renderWithProviders(<AccountPage />);
    const first = await screen.findByLabelText('Legal first name');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(first, { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Legal last name'), { target: { value: 'Lovelace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({ name: 'Ada Owner', legalFirstName: 'Ada', legalLastName: 'Lovelace' });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
    expect(screen.getByLabelText('Legal last name')).toHaveValue('Lovelace');
  });

  it('shows email verification status and sends a link when not verified', async () => {
    const fetchMock = mockApi({
      '/v1/auth/me': { user: user(), permissions: [] },
      '/v1/auth/email/verify/send': { ok: true },
    });
    renderWithProviders(<AccountPage />);
    expect(await screen.findByText('Not verified')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify email' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === '/v1/auth/email/verify/send')).toBe(true));
    expect(await screen.findByText(/link works once and expires in 24 hours/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Resend link' })).toBeInTheDocument();
  });

  it('shows the email as verified with no action needed', async () => {
    mockApi({ '/v1/auth/me': { user: user({ emailVerified: true }), permissions: [] } });
    renderWithProviders(<AccountPage />);
    expect(await screen.findByText('Verified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Verify email' })).not.toBeInTheDocument();
  });

  it('shows a status for the phone number: not added, not verified, verified', async () => {
    mockApi({ '/v1/auth/me': { user: user({ emailVerified: true }), permissions: [] } });
    const { unmount } = renderWithProviders(<AccountPage />);
    expect(await screen.findByText('Not added')).toHaveClass('pill', 'gray');
    unmount();
    mockApi({ '/v1/auth/me': { user: user({ emailVerified: true, phone: '+14155550123' }), permissions: [] } });
    const second = renderWithProviders(<AccountPage />);
    expect(await screen.findByText('Not verified')).toHaveClass('pill', 'amber');
    second.unmount();
    mockApi({ '/v1/auth/me': { user: user({ emailVerified: true, phone: '+14155550123', phoneVerified: true }), permissions: [] } });
    renderWithProviders(<AccountPage />);
    expect((await screen.findAllByText('Verified')).length).toBe(2); // email and phone
  });

  it('adds a phone number, sends a code, and confirms it', async () => {
    const fetchMock = mockApi({
      '/v1/auth/me': { user: user(), permissions: [] },
      '/v1/auth/phone': { user: user({ phone: '+14155550123' }) },
      '/v1/auth/phone/verify/send': { ok: true },
      '/v1/auth/phone/verify/confirm': { user: user({ phone: '+14155550123', phoneVerified: true }) },
    });
    renderWithProviders(<AccountPage />);
    const phoneInput = await screen.findByLabelText('Phone number');
    fireEvent.change(phoneInput, { target: { value: '+14155550123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save phone number' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([u]) => String(u) === '/v1/auth/phone');
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({ phone: '+14155550123' });
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Send code' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === '/v1/auth/phone/verify/send')).toBe(true));

    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '042917' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      const confirm = fetchMock.mock.calls.find(([u]) => String(u) === '/v1/auth/phone/verify/confirm');
      expect(JSON.parse(String(confirm?.[1]?.body))).toEqual({ code: '042917' });
    });
    expect(await screen.findByText('Verified')).toBeInTheDocument();
  });

  it('lists other signed-in devices with a Sign out button, and marks this one', async () => {
    window.location.hash = '#sessions';
    mockApi({
      '/v1/auth/me': { user: user(), permissions: [] },
      '/v1/auth/sessions': {
        sessions: [
          { id: 'sess_this', current: true, createdAt: 1000, lastSeen: 2000, ip: '10.0.0.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36' },
          { id: 'sess_other', current: false, createdAt: 500, lastSeen: 900, ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1' },
        ],
      },
    });
    renderWithProviders(<AccountPage />);
    expect(await screen.findByText('This device')).toBeInTheDocument();
    expect(screen.getByText(/Chrome on Windows/)).toBeInTheDocument();
    expect(screen.getByText(/Safari on iOS/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out everywhere else' })).toBeInTheDocument();
    // Only the other device gets its own per-device sign-out button; this one is ended from the nav instead,
    // whose plain "Sign out" stays the only exact match of that name.
    expect(screen.getByRole('button', { name: 'Sign out Safari on iOS' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);
  });

  it('signs out one other device without touching this one', async () => {
    window.location.hash = '#sessions';
    let revoked = false;
    const fetchMock = mockApi({
      '/v1/auth/me': { user: user(), permissions: [] },
      '/v1/auth/sessions': () => ({
        sessions: revoked
          ? [{ id: 'sess_this', current: true, createdAt: 1000, lastSeen: 2000, ip: '10.0.0.1', userAgent: null }]
          : [
              { id: 'sess_this', current: true, createdAt: 1000, lastSeen: 2000, ip: '10.0.0.1', userAgent: null },
              { id: 'sess_other', current: false, createdAt: 500, lastSeen: 900, ip: '203.0.113.9', userAgent: null },
            ],
      }),
      '/v1/auth/sessions/sess_other/revoke': () => { revoked = true; return { ok: true }; },
    });
    renderWithProviders(<AccountPage />);
    // Not the nav's plain "Sign out" (that would end this device): the per-device button is named after the device.
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out Unknown device' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/v1/auth/sessions/sess_other/revoke'))).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign out Unknown device' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument(); // the nav's own sign-out is untouched
  });

  it('signs out every other device after confirming, and reports how many', async () => {
    window.location.hash = '#sessions';
    let revoked = false;
    mockApi({
      '/v1/auth/me': { user: user(), permissions: [] },
      '/v1/auth/sessions': () => ({
        sessions: revoked
          ? [{ id: 'sess_this', current: true, createdAt: 1000, lastSeen: 2000, ip: '10.0.0.1', userAgent: null }]
          : [
              { id: 'sess_this', current: true, createdAt: 1000, lastSeen: 2000, ip: '10.0.0.1', userAgent: null },
              { id: 'sess_a', current: false, createdAt: 500, lastSeen: 900, ip: '203.0.113.9', userAgent: null },
              { id: 'sess_b', current: false, createdAt: 400, lastSeen: 800, ip: '203.0.113.10', userAgent: null },
            ],
      }),
      '/v1/auth/sessions/revoke-all': () => { revoked = true; return { revoked: 2 }; },
    });
    renderWithProviders(<AccountPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere else' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, sign out' }));
    expect(await screen.findByText(/Signed out of 2 other sessions/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out everywhere else' })).not.toBeInTheDocument();
  });
});
