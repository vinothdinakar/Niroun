import { loadEncryptionKey } from '../domain/totp';
import { FileStore, MemoryFileStore } from '../storage/file-store';

export const BOND_OPTIONS = Symbol('BOND_OPTIONS');

export interface Clock { now(): number }

// Everything configurable about a running API. `main.ts` fills it from the environment; tests and the
// demo pass their own (a virtual clock, a throwaway database, an in-memory mailbox).
export interface BondOptions {
  /** MongoDB connection string. It must point at a replica set (single-node is fine): transactions require one. */
  mongoUrl: string;
  /** Database name inside that MongoDB. */
  mongoDb: string;
  /** Drop the database when the app closes. Tests only. */
  dropDbOnClose: boolean;
  /** How long to wait for MongoDB to answer before giving up at start-up. */
  mongoTimeoutMs: number;
  clock: Clock;
  cookieSecure: boolean;
  /** Origins of the dashboard(s) allowed to make cookie-authenticated writes through a proxy. */
  allowedOrigins: string[];
  /** Believe X-Forwarded-For. ONLY behind a proxy you control; otherwise anyone can fake their address. */
  trustProxy: boolean;
  /** Seals two-factor secrets at rest. */
  encryptionKey: Buffer;
  /** 'open': anyone may register a company (after verifying their email). 'closed': invitations only. */
  signup: 'open' | 'closed';
  /** Demo and tests: keep emails in memory and expose them at /v1/dev/outbox instead of sending. */
  devMailbox: boolean;
  /** The dashboard's public URL, used in emailed links. Defaults to http://localhost:<port> once listening. */
  publicUrl: string | undefined;
  /** How often to run the expiry sweep, in ms. 0 disables it (tests call it explicitly). */
  sweepIntervalMs: number;
  /** Where KYB/KYC evidence files are kept (Google Cloud Storage in production). */
  fileStore: FileStore;
  /** Evidence files are deleted this many days after their verification request is decided. */
  docRetentionDays: number;
}

export const DEFAULT_MONGO_URL = 'mongodb://127.0.0.1:27018/?replicaSet=bond0';

export function resolveOptions(partial: Partial<BondOptions> & { keyFile?: string | null } = {}): BondOptions {
  return {
    mongoUrl: partial.mongoUrl ?? process.env.BOND_MONGO_URL ?? DEFAULT_MONGO_URL,
    mongoDb: partial.mongoDb ?? process.env.BOND_MONGO_DB ?? 'bond',
    dropDbOnClose: partial.dropDbOnClose ?? false,
    mongoTimeoutMs: partial.mongoTimeoutMs ?? 8000,
    clock: partial.clock ?? { now: () => Date.now() },
    cookieSecure: partial.cookieSecure ?? process.env.BOND_COOKIE_SECURE === '1',
    allowedOrigins: partial.allowedOrigins ?? [],
    trustProxy: partial.trustProxy ?? false,
    encryptionKey: partial.encryptionKey ?? loadEncryptionKey(partial.keyFile ?? null),
    signup: partial.signup ?? 'closed',
    devMailbox: partial.devMailbox ?? false,
    publicUrl: partial.publicUrl ?? process.env.BOND_PUBLIC_URL,
    sweepIntervalMs: partial.sweepIntervalMs ?? 0,
    fileStore: partial.fileStore ?? new MemoryFileStore(),
    docRetentionDays: partial.docRetentionDays ?? 90,
  };
}
