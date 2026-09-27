import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, mockError } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import LoginPage from './page';

describe('dashboard LoginPage', () => {
  it('offers a signup link once the API says company signup is open', async () => {
    mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'open', devMailbox: false } });
    renderWithProviders(<LoginPage />);
    expect(await screen.findByRole('link', { name: /Create an account for your company/i })).toBeInTheDocument();
  });

  it('offers no signup link when it is closed', async () => {
    const fetchMock = mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'closed', devMailbox: false } });
    renderWithProviders(<LoginPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/health', expect.anything()));
    expect(screen.queryByRole('link', { name: /create an account/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Accounts are created by invitation/i)).toBeInTheDocument();
  });
});
