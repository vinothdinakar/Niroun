import { Role, User } from '../storage/db.types';

// People who sign in to the console: staff (Bond) and customers (agent owners).
// Agents never sign in; they use signed requests (see agent-auth.ts).

export const ROLES: Record<Role, { staff: boolean; label: string }> = {
  admin: { staff: true, label: 'Bond admin' },
  reviewer: { staff: true, label: 'Bond reviewer' },
  owner_admin: { staff: false, label: 'Owner admin' },
  owner_viewer: { staff: false, label: 'Owner viewer' },
};
export const OWNER_ROLES: Role[] = ['owner_admin', 'owner_viewer'];

export type Permission =
  | 'stats' | 'orgs' | 'audit' | 'verify' | 'sweep' | 'resolve'
  | 'agents_manage' | 'agents_suspend' | 'team_manage' | 'enroll' | 'request_verification';

// Reading is scoped by role (staff: everything; owners: their own company) and is not a permission.
// These are the actions. For non-staff, every action is additionally limited to their own org.
const PERMS: Record<Role, Set<Permission>> = {
  admin: new Set<Permission>(['stats', 'orgs', 'audit', 'verify', 'sweep', 'resolve', 'agents_manage', 'agents_suspend', 'team_manage', 'enroll']),
  reviewer: new Set<Permission>(['stats', 'resolve', 'agents_suspend']),
  owner_admin: new Set<Permission>(['agents_manage', 'agents_suspend', 'team_manage', 'enroll', 'request_verification']),
  owner_viewer: new Set<Permission>(),
};

export const permissionsOf = (role: Role): Permission[] => [...(PERMS[role] ?? [])];
export const can = (user: Pick<User, 'role'>, perm: Permission): boolean => PERMS[user.role]?.has(perm) ?? false;
export const isStaff = (user: Pick<User, 'role'>): boolean => ROLES[user.role]?.staff === true;
