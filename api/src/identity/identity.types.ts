import { Role, User } from '../storage/db.types';

/** The person (or nobody, for anonymous events) an audit entry is attributed to. */
export type Actor = { id: string; email: string } | null;

/** How this person wants dates and times shown. null means "no preference": use the browser's own. */
export interface UserPreferences {
  /** An IANA time zone such as "America/Toronto". */
  timeZone: string | null;
  dateFormat: 'MDY' | 'DMY' | 'YMD' | null;
  timeFormat: '12h' | '24h' | null;
}
export const NO_PREFERENCES: UserPreferences = { timeZone: null, dateFormat: null, timeFormat: null };

const HOUR = 3_600_000;
/** A session ends this long after the last request, and never lasts longer than the maximum. */
export const SESSION_IDLE_MS = 2 * HOUR;
export const SESSION_MAX_MS = 12 * HOUR;

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
  preferences: UserPreferences;
  /** Shown on the preferences page: how long a session lasts. Set by Bond, not by the user. */
  sessionPolicy: { absoluteHours: number; idleHours: number };
}

/** Sign-in either finishes with a session, or names the step still needed (no session, no cookie yet). */
export type SignInStep =
  | { needs: 'totp' | 'enroll'; challenge: string }
  | { token: string; user: User };

export const isSession = (s: SignInStep): s is { token: string; user: User } => 'token' in s;

export interface InviteResult { user: PublicUser; inviteToken: string | null; inviteExpires: number | null }

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
