import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, mockError } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import SignupPage from './page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/signup' }));

// Fills in every required field except the two passwords, which each test sets for itself.
async function fillCommonFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Your name'), 'Sam Signup');
  await user.type(screen.getByLabelText('Work email'), 'sam@signup-test.example');
  await user.type(screen.getByLabelText('Company name'), 'Signup Test Co');
}

describe('SignupPage', () => {
  it('shows a closed message instead of the form when the API says signup is closed', async () => {
    mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'closed', devMailbox: false } });
    renderWithProviders(<SignupPage />);
    expect(await screen.findByText(/Sign-up is closed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Company name')).not.toBeInTheDocument();
  });

  it('refuses to submit when the two passwords do not match', async () => {
    mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'open', devMailbox: false } });
    const user = userEvent.setup();
    renderWithProviders(<SignupPage />);
    await fillCommonFields(user);
    await user.type(screen.getByLabelText('Password (12+ characters)'), 'a-strong-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-different-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/two passwords do not match/i)).toBeInTheDocument();
  });

  it('posts the form and moves on to check-email once the terms are accepted', async () => {
    const fetchMock = mockApi({
      '/v1/auth/me': mockError(401),
      '/v1/health': { ok: true, signup: 'open', devMailbox: false },
      '/v1/signup': {},
    });
    const user = userEvent.setup();
    renderWithProviders(<SignupPage />);
    await fillCommonFields(user);
    await user.type(screen.getByLabelText('Password (12+ characters)'), 'a-strong-password');
    await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password');
    await user.click(screen.getByRole('checkbox', { name: /accept the preview terms/i }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/signup/check-email'));
    expect(fetchMock).toHaveBeenCalledWith('/v1/signup', expect.objectContaining({ method: 'POST' }));
  });
});
