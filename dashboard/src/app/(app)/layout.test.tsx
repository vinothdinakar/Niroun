import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import AppLayout from './layout';
import { render } from '@testing-library/react';
import { AppsMenu } from '@bond/console-core/components/header-menus';

const baseUser = {
  id: 'usr_1', email: 'ada@bond.test', name: 'Ada Admin', orgId: null as string | null, orgName: null as string | null,
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'enabled' as const, recoveryCodesLeft: 5,
};

describe('dashboard app layout', () => {
  it('never shows Organizations or Audit log, even for a staff session', async () => {
    // A dashboard-served page can't grant staff-only sections by accident: its nav list simply doesn't
    // include them, regardless of what the signed-in account is allowed to do.
    mockApi({
      '/v1/auth/me': {
        user: { ...baseUser, role: 'admin' },
        permissions: ['stats', 'orgs', 'audit', 'verify', 'sweep', 'resolve', 'agents_manage', 'agents_suspend', 'team_manage', 'enroll'],
      },
    });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.queryByRole('link', { name: /Organizations/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Audit log/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect agents' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Organization' })).toBeInTheDocument();
  });

  it('hides Connect for an owner_viewer, who lacks enroll (Organization stays, for the profile)', async () => {
    mockApi({ '/v1/auth/me': { user: { ...baseUser, role: 'owner_viewer', orgId: 'org_1', orgName: 'Acme Corp' }, permissions: [] } });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.queryByRole('link', { name: 'Connect agents' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Organization' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Verification' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
  });

  it('shows Deals, Disputes and Agent Marketplace to every role — reading is scoped, not permission-gated', async () => {
    mockApi({ '/v1/auth/me': { user: { ...baseUser, role: 'owner_viewer', orgId: 'org_1', orgName: 'Acme Corp' }, permissions: [] } });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    await screen.findByRole('link', { name: 'Overview' });
    expect(screen.getByRole('link', { name: 'Deals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Disputes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agent Marketplace' })).toBeInTheDocument();
  });

  it('puts Account settings in the profile menu', async () => {
    mockApi({ '/v1/auth/me': { user: { ...baseUser, role: 'owner_viewer', orgId: 'org_1', orgName: 'Acme Corp' }, permissions: [] } });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    fireEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menuitem', { name: 'Account settings' })).toHaveAttribute('href', '/account');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('has a grid menu in the top right listing Support, Docs, Email, Phone and Man in Middle', async () => {
    mockApi({ '/v1/auth/me': { user: { ...baseUser, role: 'owner_viewer', orgId: 'org_1', orgName: 'Acme Corp' }, permissions: [] } });
    renderWithProviders(<AppLayout><div>content</div></AppLayout>);
    const button = await screen.findByRole('button', { name: 'Help and contact' });
    expect(screen.queryByRole('menuitem', { name: 'Support' })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Support', 'Docs', 'Email', 'Phone', 'Man in Middle']);
    // nothing is configured in tests, so every tile is shown greyed out rather than linking nowhere
    for (const item of screen.getAllByRole('menuitem')) expect(item).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('AppsMenu links', () => {
  it('links each tile to its address: external pages in a new tab, mailto and tel for email and phone', () => {
    render(<AppsMenu links={{ support: 'https://help.example.com', docs: 'https://docs.example.com', email: 'help@example.com', phone: '+1 (415) 555-0123', mitm: undefined }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Help and contact' }));
    expect(screen.getByRole('menuitem', { name: 'Support' })).toHaveAttribute('href', 'https://help.example.com');
    expect(screen.getByRole('menuitem', { name: 'Support' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('menuitem', { name: 'Support' })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('menuitem', { name: 'Docs' })).toHaveAttribute('href', 'https://docs.example.com');
    expect(screen.getByRole('menuitem', { name: 'Email' })).toHaveAttribute('href', 'mailto:help@example.com');
    expect(screen.getByRole('menuitem', { name: 'Phone' })).toHaveAttribute('href', 'tel:+14155550123');
    expect(screen.getByRole('menuitem', { name: 'Man in Middle' })).toHaveAttribute('aria-disabled', 'true'); // no address given
  });

  it('closes on Escape', () => {
    render(<AppsMenu links={{ support: 'https://help.example.com', docs: undefined, email: undefined, phone: undefined, mitm: undefined }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Help and contact' }));
    expect(screen.getByRole('menuitem', { name: 'Support' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem', { name: 'Support' })).not.toBeInTheDocument();
  });
});
