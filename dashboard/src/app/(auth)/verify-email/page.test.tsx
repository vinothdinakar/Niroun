import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, mockError } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import VerifyEmailPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/verify-email' }));

describe('VerifyEmailPage', () => {
  it('shows a failure message when the link has no token', async () => {
    mockApi({ '/v1/auth/me': mockError(401) });
    window.location.hash = '';
    renderWithProviders(<VerifyEmailPage />);
    expect(await screen.findByText(/link can.t be used/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('shows the API error and a way back when the token is invalid or expired', async () => {
    mockApi({
      '/v1/auth/me': mockError(401),
      '/v1/auth/email/verify/confirm': mockError(400, { error: { code: 'INVALID_VERIFICATION', message: 'This verification link is invalid or has expired.' } }),
    });
    window.location.hash = '#token=some-token';
    renderWithProviders(<VerifyEmailPage />);
    expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('confirms the email and offers to sign in, when nobody is signed in here', async () => {
    mockApi({
      '/v1/auth/me': mockError(401),
      '/v1/auth/email/verify/confirm': { email: 'ada@acme.test' },
    });
    window.location.hash = '#token=some-token';
    renderWithProviders(<VerifyEmailPage />);
    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    expect(screen.getByText(/ada@acme.test is confirmed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  });

  it('offers to go back to the account, for someone already signed in here', async () => {
    mockApi({
      '/v1/auth/me': {
        user: {
          id: 'usr_1', email: 'ada@acme.test', name: 'Ada Owner', legalFirstName: null, legalLastName: null,
          role: 'owner_admin', orgId: 'org_1', orgName: 'Acme Corp', disabled: false, createdAt: 0, lastLoginAt: 0,
          pendingInvite: false, mfa: 'off', recoveryCodesLeft: null, emailVerified: false, phone: null, phoneVerified: false,
        },
        permissions: [],
      },
      '/v1/auth/email/verify/confirm': { email: 'ada@acme.test' },
    });
    window.location.hash = '#token=some-token';
    renderWithProviders(<VerifyEmailPage />);
    expect(await screen.findByText('Email verified')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Back to your account' })).toHaveAttribute('href', '/account#profile');
  });
});
