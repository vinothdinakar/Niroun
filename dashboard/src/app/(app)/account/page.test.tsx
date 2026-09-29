import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import AccountPage from './page';

const user = (over: Record<string, unknown> = {}) => ({
  id: 'usr_1', email: 'ada@acme.test', name: 'Ada Owner', role: 'owner_admin', orgId: 'org_1', orgName: 'Acme Corp',
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off', recoveryCodesLeft: null, ...over,
});

afterEach(() => { window.location.hash = ''; });

describe('AccountPage', () => {
  it('shows who you are, with a menu of sections opening on Profile', async () => {
    mockApi({ '/v1/auth/me': { user: user(), permissions: [] } });
    renderWithProviders(<AccountPage />);
    expect(await screen.findByLabelText('Name')).toHaveValue('Ada Owner');
    expect(screen.getByText('ada@acme.test')).toBeInTheDocument();
    expect(screen.getByText('AO')).toBeInTheDocument();
    expect(screen.getByText('Owner admin')).toHaveClass('pill');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Profile', 'Password', 'Two-step verification']);
    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not tell an org owner that someone invited them', async () => {
    mockApi({ '/v1/auth/me': { user: user(), permissions: [] } });
    renderWithProviders(<AccountPage />);
    await screen.findByLabelText('Name');
    expect(screen.queryByText(/whoever invited you/)).not.toBeInTheDocument();
    expect(screen.getByText(/email and role are fixed/)).toBeInTheDocument();
  });

  it('tells a viewer to ask their organization\'s admins', async () => {
    mockApi({ '/v1/auth/me': { user: user({ role: 'owner_viewer' }), permissions: [] } });
    renderWithProviders(<AccountPage />);
    await screen.findByLabelText('Name');
    expect(screen.getByText(/Ask one of them/)).toBeInTheDocument();
  });

  it('shows the selected section on the right and keeps the choice in the address', async () => {
    mockApi({ '/v1/auth/me': { user: user(), permissions: [] } });
    renderWithProviders(<AccountPage />);
    await screen.findByLabelText('Name');
    fireEvent.click(screen.getByRole('tab', { name: 'Password' }));
    expect(await screen.findByRole('button', { name: 'Change password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#password');
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

  it('saves a new display name through PUT /v1/auth/me and shows it', async () => {
    const fetchMock = mockApi({
      '/v1/auth/me': (_url: string, init?: RequestInit) =>
        init?.method === 'PUT' ? { user: user({ name: 'Ada L.' }), permissions: [] } : { user: user(), permissions: [] },
    });
    renderWithProviders(<AccountPage />);
    const input = await screen.findByLabelText('Name');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Ada L.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(JSON.parse(String(put?.[1]?.body))).toEqual({ name: 'Ada L.' });
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled());
    expect(screen.getByLabelText('Name')).toHaveValue('Ada L.');
  });
});
