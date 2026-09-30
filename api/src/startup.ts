// What the API says about itself while it starts, and how it explains a failed start. On a hosted service (Cloud Run)
// these lines are all you get: if the container never listens, the log is the only way to see where it stopped.
//
// Rules: never print a secret (passwords in URLs, keys, tokens). Say whether a secret is PRESENT, not what it is.

type Env = Record<string, string | undefined>;

/** `mongodb+srv://user:pass@host/db?x=y` becomes `mongodb+srv://***@host/db?x=y`. */
export const redactUrl = (url: string): string => url.replace(/\/\/([^@/]+)@/, '//***@');

/** Just the host part of a connection string ("cluster0.abc.mongodb.net", "127.0.0.1:27017"). */
export function hostOf(url: string | undefined): string {
  if (!url) return 'default (local)';
  const m = /^[a-z+]+:\/\/(?:[^@/]*@)?([^/?]+)/i.exec(url);
  return m ? m[1] : 'unreadable';
}

const yesNo = (v: string | undefined): string => (v ? 'yes' : 'no');

/** One line per fact, safe to print. `port` is the port the API will listen on. */
export function describeEnvironment(env: Env, port: number): string[] {
  const lines: string[] = [];
  lines.push(`runtime: node ${process.version} on ${process.platform}/${process.arch}, NODE_ENV=${env.NODE_ENV ?? 'unset'}, PORT=${port}${env.PORT ? '' : ' (default: PORT is not set)'}, pid ${process.pid}`);
  lines.push(`memory: heap limit ${Math.round((require('node:v8') as typeof import('node:v8')).getHeapStatistics().heap_size_limit / 1048576)} MB`);
  if (env.K_SERVICE) lines.push(`cloud run: service ${env.K_SERVICE}, revision ${env.K_REVISION ?? '?'}, configuration ${env.K_CONFIGURATION ?? '?'}`);
  lines.push(`mongo: host ${hostOf(env.BOND_MONGO_URL)}, database ${env.BOND_MONGO_DB ?? 'bond'}`);
  lines.push(`secrets present: BOND_MONGO_URL=${yesNo(env.BOND_MONGO_URL)}, BOND_ENCRYPTION_KEY=${yesNo(env.BOND_ENCRYPTION_KEY)}${env.BOND_ENCRYPTION_KEY ? '' : ` (falls back to key file ${env.BOND_KEY_FILE ?? 'data/encryption.key'})`}, RESEND_API_KEY=${yesNo(env.RESEND_API_KEY)}, STRIPE_SECRET_KEY=${yesNo(env.STRIPE_SECRET_KEY)}, STRIPE_WEBHOOK_SECRET=${yesNo(env.STRIPE_WEBHOOK_SECRET)}, STRIPE_CONNECT_WEBHOOK_SECRET=${yesNo(env.STRIPE_CONNECT_WEBHOOK_SECRET)}`);
  lines.push(`urls: dashboard ${env.BOND_PUBLIC_URL || 'http://localhost:3300 (default)'}, staff ${env.BOND_STAFF_URL || 'http://localhost:3400 (default)'}${env.BOND_ALLOWED_ORIGINS ? `, allowed origins ${env.BOND_ALLOWED_ORIGINS}` : ''}`);
  lines.push(`files: ${env.BOND_GCS_BUCKET ? `Google Cloud Storage bucket ${env.BOND_GCS_BUCKET}` : 'local disk (data/uploads), development only'}`);
  lines.push(`email: ${env.BOND_DEV_MAILBOX === '1' ? 'in-memory demo mailbox, nothing is sent' : env.RESEND_API_KEY ? `Resend, from ${env.BOND_MAIL_FROM ?? 'Bond <no-reply@assetslices.com>'}` : 'printed to the console, nothing is sent'}`);
  const stripeMode = !env.STRIPE_SECRET_KEY ? 'off (no STRIPE_SECRET_KEY)' : /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY) ? 'on, TEST mode' : 'on, LIVE mode';
  lines.push(`wallet: Stripe ${stripeMode}`);
  lines.push(`http: signup ${env.BOND_SIGNUP === 'open' ? 'open' : 'closed'}, secure cookies ${env.BOND_COOKIE_SECURE === '1' ? 'on' : 'off'}, trust proxy ${env.BOND_TRUST_PROXY === '1' ? 'on' : 'off'}`);
  return lines;
}

/** Things that look wrong in the configuration before anything is started. Each is a warning, not a stop. */
export function configProblems(env: Env): string[] {
  const out: string[] = [];
  const production = env.NODE_ENV === 'production';
  if (production && !env.BOND_MONGO_URL) out.push('BOND_MONGO_URL is not set: the API will try a local MongoDB, which does not exist here.');
  if (production && !env.BOND_ENCRYPTION_KEY) out.push('BOND_ENCRYPTION_KEY is not set: two-factor secrets would be sealed with a key file on this container\'s disk, and lost on the next deploy.');
  if (production && env.BOND_COOKIE_SECURE !== '1') out.push('BOND_COOKIE_SECURE is not 1: session cookies will not be marked Secure.');
  if (production && !env.BOND_PUBLIC_URL) out.push('BOND_PUBLIC_URL is not set: links in emails will point at http://localhost:3300.');
  for (const name of ['BOND_PUBLIC_URL', 'BOND_STAFF_URL'] as const) {
    if (env[name] && !/^https?:\/\/[^\s/]+/.test(env[name] as string)) out.push(`${name} is not a full URL ("${env[name]}"): it must look like https://example.com.`);
  }
  if (env.BOND_ENCRYPTION_KEY && Buffer.from(env.BOND_ENCRYPTION_KEY, 'base64').length !== 32) out.push('BOND_ENCRYPTION_KEY does not decode to exactly 32 bytes (it must be base64 of 32 random bytes).');
  if (env.RESEND_API_KEY && env.BOND_DEV_MAILBOX === '1') out.push('BOND_DEV_MAILBOX=1 overrides RESEND_API_KEY: no real email will be sent.');
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET && !env.STRIPE_CONNECT_WEBHOOK_SECRET) out.push('STRIPE_WEBHOOK_SECRET is not set: Stripe webhooks will be refused.');
  if (env.STRIPE_SECRET_KEY && production && /^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) out.push('Stripe is in TEST mode on a production server.');
  if (env.RESEND_API_KEY !== undefined && env.RESEND_API_KEY !== env.RESEND_API_KEY.trim()) out.push('RESEND_API_KEY has leading or trailing whitespace (a stray newline in the secret?).');
  return out;
}

/** Plain-language likely causes for a startup error, from its message. Empty when there is nothing useful to add. */
export function startupHints(err: unknown): string[] {
  const text = `${(err as Error)?.name ?? ''} ${(err as Error)?.message ?? String(err)}`;
  const hints: string[] = [];
  if (/MongoServerSelectionError|Cannot reach MongoDB|ECONNREFUSED|ENOTFOUND|querySrv|ETIMEDOUT|Server selection timed out/i.test(text)) {
    hints.push('MongoDB is not reachable. On Atlas: Network Access must allow this host (Cloud Run has no fixed address, so allow 0.0.0.0/0), and the host in BOND_MONGO_URL must be right.');
  }
  if (/Authentication failed|bad auth|AuthenticationFailed|not authorized|Unauthorized/i.test(text)) {
    hints.push('MongoDB rejected the login or the permission. Check the user and password in BOND_MONGO_URL (special characters in the password must be URL-encoded), and that the user can read and write this database.');
  }
  if (/IndexOptionsConflict|IndexKeySpecsConflict|E11000|already exists with (a )?different/i.test(text)) {
    hints.push('An index could not be created: an existing index conflicts with it, or existing data breaks a unique index.');
  }
  if (/BOND_ENCRYPTION_KEY|32 bytes/i.test(text)) hints.push('BOND_ENCRYPTION_KEY must be base64 of exactly 32 random bytes (openssl rand -base64 32).');
  if (/Invalid URL|ERR_INVALID_URL/i.test(text)) hints.push('One of BOND_PUBLIC_URL, BOND_STAFF_URL or BOND_ALLOWED_ORIGINS is not a full URL (it must look like https://example.com).');
  if (/EADDRINUSE/.test(text)) hints.push('The port is already in use by another process.');
  if (/EACCES/.test(text)) hints.push('Permission denied: the process is not allowed to use that port or file.');
  if (/Cannot find module|MODULE_NOT_FOUND/i.test(text)) hints.push('A dependency is missing from the built image (was `npm ci` run, and was anything pruned that the app needs at run time?).');
  if (/ENOSPC|EROFS|read-only file system/i.test(text)) hints.push('The container cannot write to disk here (a read-only or full file system).');
  if (/storage|bucket|gcs|403|permission_denied|PERMISSION_DENIED/i.test(text) && /google|gcs|bucket|storage/i.test(text)) {
    hints.push('Google Cloud Storage refused or could not find the bucket: check BOND_GCS_BUCKET and that the runtime service account has access to it.');
  }
  return hints;
}

/** "1.2 s" or "340 ms". */
export const took = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
