import { useFlow } from '@bond/console-core/lib/flow';
import { screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi, mockError } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import CheckEmailPage from './page';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }), usePathname: () => '/signup/check-email' }));

// Seeds flow.signupEmail before rendering — the same call SignupPage makes on a real submit — so this page's
// own rendering logic can be tested without re-driving the whole signup form through it.
function Primed({ email }: { email: string }) {
  const flow = useFlow();
  useEffect(() => { flow.setSignupEmail(email); }, [email]); // eslint-disable-line react-hooks/exhaustive-deps
  return <CheckEmailPage />;
}

describe('CheckEmailPage', () => {
  it('sends you back to the signup form when there is no address to show (e.g. after a reload)', async () => {
    mockApi({ '/v1/auth/me': mockError(401) });
    renderWithProviders(<CheckEmailPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/signup'));
  });

  it('shows the address and a way to open the demo mailbox when the API runs one', async () => {
    mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'open', devMailbox: true } });
    renderWithProviders(<Primed email="sam@signup-test.example" />);
    expect(await screen.findByText('sam@signup-test.example')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Show my verification email/i })).toBeInTheDocument();
  });

  it('hides the demo mailbox button outside demo mode', async () => {
    mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'open', devMailbox: false } });
    renderWithProviders(<Primed email="sam@signup-test.example" />);
    await screen.findByText('sam@signup-test.example');
    expect(screen.queryByRole('button', { name: /Show my verification email/i })).not.toBeInTheDocument();
  });
});
