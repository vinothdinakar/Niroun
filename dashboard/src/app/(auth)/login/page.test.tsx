import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, mockError } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import LoginPage from './page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/login' }));

describe('dashboard LoginPage', () => {
  it('offers a signup link once the API says company signup is open', async () => {
    mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'open', devMailbox: false } });
    renderWithProviders(<LoginPage />);
    expect(await screen.findByRole('link', { name: /^Create an account$/i })).toBeInTheDocument();
  });

  it('offers no signup link when it is closed', async () => {
    const fetchMock = mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'closed', devMailbox: false } });
    renderWithProviders(<LoginPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/health', expect.anything()));
    expect(screen.queryByRole('link', { name: /create an account/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Accounts are created by invitation/i)).toBeInTheDocument();
  });

  it('sends someone whose email is not verified yet to the check-your-email screen', async () => {
    mockApi({
      '/v1/auth/me': mockError(401),
      '/v1/health': { ok: true, signup: 'open', devMailbox: false },
      '/v1/auth/login': mockError(403, { error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email address.' } }),
    });
    renderWithProviders(<LoginPage />);
    await userEvent.type(await screen.findByLabelText('Email'), 'pat@widgets.test');
    await userEvent.type(screen.getByLabelText('Password'), 'Correct-horse-1');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/signup/check-email'));
  });
});
