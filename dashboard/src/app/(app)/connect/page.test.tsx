import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import ConnectPage from './page';

afterEach(() => { vi.unstubAllEnvs(); });

const owner = { id: 'usr_1', email: 'pat@acme.test', name: 'Pat', orgId: 'org_1', orgName: "Pat's Org - 2026-09-30", role: 'owner_admin' as const, disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off' as const, recoveryCodesLeft: null };
const org = { id: 'org_1', name: "Pat's Org - 2026-09-30", accountType: 'business', verification: 0, createdAt: 0 };

function boot(extra: Record<string, unknown> = {}) {
  return mockApi({
    '/v1/auth/me': { user: owner, permissions: ['enroll'] },
    '/v1/console/orgs': { orgs: [org] },
    '/v1/agents': { agents: [] },
    ...extra,
  });
}
const exampleText = () => screen.getByText(/BondClient\.register/).textContent ?? '';

describe('Connect page quickstart', () => {
  it('shows where the API is, the steps, and an example already filled in with this organization', async () => {
    vi.stubEnv('NEXT_PUBLIC_BOND_API_URL', 'https://niroun-api.example.test/');
    vi.stubEnv('NEXT_PUBLIC_DOCS_URL', 'https://bond.example.test/docs');
    boot();
    renderWithProviders(<ConnectPage />);
    expect(await screen.findByRole('heading', { name: 'Quickstart' })).toBeInTheDocument();
    expect(screen.getByText('https://niroun-api.example.test')).toBeInTheDocument(); // trailing slash dropped
    expect(screen.getByText(/Generate an enrollment code/)).toBeInTheDocument();
    expect(screen.getByText(/owned by Pat's Org - 2026-09-30/)).toBeInTheDocument();
    const example = exampleText();
    expect(example).toContain('baseUrl: "https://niroun-api.example.test"');
    expect(example).toContain("owner: \"Pat's Org - 2026-09-30\""); // an apostrophe in the name can't break the code
    expect(example).toContain('enrollmentCode: "PASTE-YOUR-ENROLLMENT-CODE"');
    const docs = screen.getByRole('link', { name: 'Full API reference' });
    expect(docs).toHaveAttribute('href', 'https://bond.example.test/docs');
    expect(docs).toHaveAttribute('target', '_blank');
    expect(docs).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('puts the real enrollment code into the example once one is generated', async () => {
    vi.stubEnv('NEXT_PUBLIC_BOND_API_URL', 'https://niroun-api.example.test');
    const fetchMock = boot({ '/v1/console/enrollments': { code: 'ENR-ABCD-1234', orgName: "Pat's Org - 2026-09-30", expiresAt: Date.UTC(2026, 9, 7) } });
    renderWithProviders(<ConnectPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate enrollment code' }));
    await waitFor(() => expect(exampleText()).toContain('enrollmentCode: "ENR-ABCD-1234"'));
    expect(screen.getByText(/Example \(with your new code\)/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u, init]) => String(u) === '/v1/console/enrollments' && init?.method === 'POST')).toBe(true);
  });

  it('copies the address and the example', async () => {
    vi.stubEnv('NEXT_PUBLIC_BOND_API_URL', 'https://niroun-api.example.test');
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    boot();
    renderWithProviders(<ConnectPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Copy address' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://niroun-api.example.test'));
    fireEvent.click(screen.getByRole('button', { name: 'Copy example' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining('BondClient.register')));
  });

  it('degrades gracefully when the API address or docs link are not configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_BOND_API_URL', '');
    vi.stubEnv('NEXT_PUBLIC_DOCS_URL', '');
    boot();
    renderWithProviders(<ConnectPage />);
    expect(await screen.findByText(/Ask your administrator for it/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy address' })).not.toBeInTheDocument();
    expect(exampleText()).toContain('baseUrl: process.env.BOND_URL');
    expect(screen.queryByRole('link', { name: 'Full API reference' })).not.toBeInTheDocument();
  });
});
