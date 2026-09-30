import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, mockError } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import SignupPage from './page';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/signup' }));

const open = { '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'open', devMailbox: false } };

describe('SignupPage', () => {
  it('shows a closed message instead of the form when the API says signup is closed', async () => {
    mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'closed', devMailbox: false } });
    renderWithProviders(<SignupPage />);
    expect(await screen.findByText(/Sign-up is closed/i)).toBeInTheDocument();
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
  });

  it('asks only for an email and a password (plus the terms), with no name, company or account type', async () => {
    mockApi(open);
    renderWithProviders(<SignupPage />);
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password (12+ characters)')).toBeInTheDocument();
    for (const gone of ['Your name', 'Company name', 'Confirm password']) expect(screen.queryByLabelText(gone)).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('posts just the email and password and moves on to check-email once the terms are accepted', async () => {
    const fetchMock = mockApi({ ...open, '/v1/signup': {} });
    const user = userEvent.setup();
    renderWithProviders(<SignupPage />);
    await user.type(await screen.findByLabelText('Email'), 'sam@signup-test.example');
    await user.type(screen.getByLabelText('Password (12+ characters)'), 'a-strong-password');
    await user.click(screen.getByRole('checkbox', { name: /accept the preview terms/i }));
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/signup/check-email'));
    const body = JSON.parse(String(fetchMock.mock.calls.at(-1)?.[1]?.body));
    expect(body).toEqual({ email: 'sam@signup-test.example', password: 'a-strong-password', acceptTerms: true, website: '' });
  });
});
