import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, mockError } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import VerifyPage from './page';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/verify' }));

describe('VerifyPage', () => {
  it('shows a failure message when the link has no token', async () => {
    mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'closed', devMailbox: false } });
    window.location.hash = '';
    renderWithProviders(<VerifyPage />);
    expect(await screen.findByText(/link can.t be used/i)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Back to sign in' })).toBeInTheDocument();
  });

  it('offers "Start again" instead when signup is open', async () => {
    mockApi({
      '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'open', devMailbox: false },
      '/v1/signup/verify': mockError(400, { error: { code: 'INVALID_TOKEN', message: 'This link has expired or was already used.' } }),
    });
    window.location.hash = '#token=some-token';
    renderWithProviders(<VerifyPage />);
    expect(await screen.findByRole('link', { name: 'Start again' })).toBeInTheDocument();
  });

  it('creates the account and shows the org name on success', async () => {
    mockApi({
      '/v1/auth/me': mockError(401),
      '/v1/signup/verify': { email: 'sam@signup-test.example', orgName: 'Signup Test Co' },
    });
    window.location.hash = '#token=some-token';
    renderWithProviders(<VerifyPage />);
    expect(await screen.findByText(/Signup Test Co is ready/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  });
});
