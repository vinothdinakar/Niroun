import { Role, User } from '../storage/db.types';

/** The person (or nobody, for anonymous events) an audit entry is attributed to. */
export type Actor = { id: string; email: string } | null;

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  legalFirstName: string | null;
  legalLastName: string | null;
  role: Role;
  orgId: string | null;
  orgName: string | null;
  disabled: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  pendingInvite: boolean;
  /** enabled: has an authenticator | required: staff who must enrol at next sign-in | off: optional and not set up */
  mfa: 'enabled' | 'required' | 'off';
  recoveryCodesLeft: number | null;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
}

/** Sign-in either finishes with a session, or names the step still needed (no session, no cookie yet). */
export type SignInStep =
  | { needs: 'totp' | 'enroll'; challenge: string }
  | { token: string; user: User };

export const isSession = (s: SignInStep): s is { token: string; user: User } => 'token' in s;

export interface InviteResult { user: PublicUser; inviteToken: string | null; inviteExpires: number | null }

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
