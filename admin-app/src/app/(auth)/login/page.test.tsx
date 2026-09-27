import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi, mockError } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import LoginPage from './page';

describe('admin-app LoginPage', () => {
  it('never offers to create an account, even when the customer dashboard has signup open', async () => {
    const fetchMock = mockApi({ '/v1/auth/me': mockError(401), '/v1/health': { ok: true, signup: 'open', devMailbox: false } });
    renderWithProviders(<LoginPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/v1/health', expect.anything()));
    expect(screen.queryByRole('link', { name: /create an account/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Ask another admin for an invite link/i)).toBeInTheDocument();
  });
});
