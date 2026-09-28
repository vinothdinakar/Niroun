import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import { AgentDetailView } from '@bond/console-core/components/agent-detail-view';

const baseUser = {
  id: 'usr_1', email: 'ada@bond.test', name: 'Ada Owner', orgId: 'org_1', orgName: 'Acme Corp',
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'off' as const, recoveryCodesLeft: null,
};

const profile = (overrides: Record<string, unknown> = {}) => ({
  id: 'agt_1', name: 'ProcureBot', owner: 'Acme Corp', orgId: 'org_1', tier: 'A', score: 900, faultRate: 0.03,
  status: 'active', verification: 0,
  history: [{ score: 880, ts: 0 }, { score: 900, ts: 1 }],
  spend: [{ day: '2026-09-27', spentCents: 1000 }],
  stats: { fulfilled: 12, faults: 1, volumeCents: 50000 },
  ...overrides,
});

const ledger = {
  verification: { ok: true, length: 3, headHash: 'abcdef0123456789' },
  entries: [{ ts: 0, type: 'agent.enrolled', data: {} }, { ts: 1, type: 'tx.funded', data: { txId: 'tx_1' } }],
};

const policy = { perTxLimitCents: 10000, dailyLimitCents: 50000, minCounterpartyScore: 550, allowedCategories: null };

describe('AgentDetailView', () => {
  it('renders score, stats, mandate and the uncapped ledger', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: ['agents_manage', 'agents_suspend'] },
      '/v1/agents/agt_1': profile(),
      '/v1/agents/agt_1/ledger': ledger,
      '/v1/console/agents/agt_1': { policy },
    });
    renderWithProviders(<AgentDetailView id="agt_1" />);
    await screen.findByText('ProcureBot');

    expect(screen.getByText((_, node) => node?.textContent === '900 / 1000 Bond Score')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // fulfilled
    expect(screen.getByText('Ledger (2 entries)')).toBeInTheDocument();
    expect(screen.getByText('agent.enrolled')).toBeInTheDocument();
    expect(screen.getByText('tx.funded')).toBeInTheDocument();
  });

  it('lets a manager suspend and resume the agent', async () => {
    let status = 'active';
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: ['agents_manage', 'agents_suspend'] },
      '/v1/agents/agt_1': () => profile({ status }),
      '/v1/agents/agt_1/ledger': ledger,
      '/v1/console/agents/agt_1': { policy },
      '/v1/console/agents/agt_1/status': (_url: string, init?: RequestInit) => {
        status = JSON.parse(String(init?.body)).status;
        return { ok: true };
      },
    });
    renderWithProviders(<AgentDetailView id="agt_1" />);
    await screen.findByText('ProcureBot');

    fireEvent.click(screen.getByRole('button', { name: 'Suspend agent' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume agent' })).toBeInTheDocument());
  });

  it('saves an edited mandate', async () => {
    const save = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true }));
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_admin' }, permissions: ['agents_manage'] },
      '/v1/agents/agt_1': profile(),
      '/v1/agents/agt_1/ledger': ledger,
      '/v1/console/agents/agt_1': { policy },
      '/v1/console/agents/agt_1/policy': save,
    });
    renderWithProviders(<AgentDetailView id="agt_1" />);
    await screen.findByText('ProcureBot');

    fireEvent.change(screen.getByLabelText('Per deal (USD)'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save mandate' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(JSON.parse(String(save.mock.calls[0][1]?.body))).toMatchObject({ perTxLimitCents: 20000 });
  });

  it('hides controls from a viewer without agents_manage/agents_suspend', async () => {
    mockApi({
      '/v1/auth/me': { user: { ...baseUser, role: 'owner_viewer' }, permissions: [] },
      '/v1/agents/agt_1': profile(),
      '/v1/agents/agt_1/ledger': ledger,
      '/v1/console/agents/agt_1': { policy },
    });
    renderWithProviders(<AgentDetailView id="agt_1" />);
    await screen.findByText('ProcureBot');

    expect(screen.queryByRole('button', { name: 'Suspend agent' })).not.toBeInTheDocument();
    expect(screen.getByText('Spending mandate (read-only)')).toBeInTheDocument();
  });
});
