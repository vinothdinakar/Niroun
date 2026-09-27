import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/mock-api';
import { renderWithProviders } from '@/test/render';
import AuditPage from './page';

const baseUser = {
  id: 'usr_1', email: 'ada@bond.test', name: 'Ada Admin', orgId: null as string | null, orgName: null as string | null,
  disabled: false, createdAt: 0, lastLoginAt: 0, pendingInvite: false, mfa: 'enabled' as const, recoveryCodesLeft: 5,
};
const adminMe = { user: { ...baseUser, role: 'admin' as const }, permissions: ['audit'] };
const reviewerMe = { user: { ...baseUser, role: 'reviewer' as const }, permissions: [] };

describe('AuditPage', () => {
  it('refuses a reviewer, who has no audit permission', async () => {
    mockApi({ '/v1/auth/me': reviewerMe });
    renderWithProviders(<AuditPage />);
    expect(await screen.findByText('Not available')).toBeInTheDocument();
  });

  it('lists audit entries for an admin', async () => {
    mockApi({
      '/v1/auth/me': adminMe,
      '/v1/console/audit': { entries: [{ ts: 0, actorEmail: 'admin@bond.test', action: 'org.verify', target: 'org_1', detail: { level: 1 } }] },
    });
    renderWithProviders(<AuditPage />);
    expect(await screen.findByText('org.verify')).toBeInTheDocument();
    expect(screen.getByText('admin@bond.test')).toBeInTheDocument();
  });
});
