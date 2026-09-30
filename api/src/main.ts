import { join } from 'node:path';
import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';
import { DiskFileStore, openGcsBucket } from './storage/file-store';
import { configProblems, describeEnvironment, startupHints, took } from './startup';
import { LiveStripeGateway } from './wallet/stripe.gateway';

// What the API says while it starts: its environment (never a secret), each phase as it begins, and, if it stops,
// which phase and the likely reason. On Cloud Run this is the only view of a container that never listens.
const log = new Logger('Startup');
const startedAt = Date.now();
let phase = 'reading configuration';
const step = (name: string): void => {
  phase = name;
  log.log(`[+${took(Date.now() - startedAt)}] ${name}`);
};

// Starts the API from environment variables. See api/README.md for the full list.
async function main(): Promise<void> {
  const port = Number(process.env.PORT) || 4100;
  log.log('Starting the Bond API');
  for (const line of describeEnvironment(process.env, port)) log.log(line);
  for (const problem of configProblems(process.env)) log.warn(problem);
  // If something hangs instead of failing (a database that never answers), say what we are waiting for.
  const heartbeat = setInterval(() => log.warn(`still busy: ${phase} (${took(Date.now() - startedAt)} since start)`), 10_000);
  heartbeat.unref();

  step('opening file storage');
  // Two separate frontends, two separate origins: the customer dashboard (signup verify links point here)
  // and the staff-only admin app (the first-run admin link points here). Both must be trusted origins, since
  // both proxy /v1/* writes through to this API with a session cookie.
  const dashboardUrl = process.env.BOND_PUBLIC_URL || 'http://localhost:3300';
  const staffUrl = process.env.BOND_STAFF_URL || 'http://localhost:3400';
  // KYB/KYC evidence: a private Google Cloud Storage bucket in production. Without one, dev falls back to a local folder.
  const bucket = process.env.BOND_GCS_BUCKET;
  const fileStore = bucket ? await openGcsBucket(bucket) : new DiskFileStore(join(__dirname, '..', 'data', 'uploads'));
  log.log(bucket ? `file storage ready: bucket ${bucket} (connected on first use)` : 'file storage ready: local disk');

  step('setting up payments');

  // Stripe, for the wallet: without a secret key the wallet is switched off.
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const stripeSecrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((s): s is string => !!s);
  const stripe = stripeKey ? new LiveStripeGateway(stripeKey, stripeSecrets) : undefined;
  log.log(stripe ? `payments ready: Stripe ${stripe.testMode ? 'test' : 'LIVE'} mode, ${stripeSecrets.length} webhook secret(s)` : 'payments off: the wallet is switched off');

  step('starting the application: connecting to MongoDB, creating indexes');
  const app = await createApp(
    {
      fileStore,
      stripe,
      docRetentionDays: Number(process.env.BOND_DOC_RETENTION_DAYS) || 90,
      // mongoUrl / mongoDb come from BOND_MONGO_URL / BOND_MONGO_DB (see config/options.ts)
      keyFile: process.env.BOND_KEY_FILE || join(__dirname, '..', 'data', 'encryption.key'),
      signup: process.env.BOND_SIGNUP === 'open' ? 'open' : 'closed', // closed unless you explicitly open it
      devMailbox: process.env.BOND_DEV_MAILBOX === '1',
      publicUrl: dashboardUrl,
      staffUrl,
      allowedOrigins: (process.env.BOND_ALLOWED_ORIGINS || `${dashboardUrl},${staffUrl}`).split(',').map((s) => s.trim()).filter(Boolean),
      trustProxy: process.env.BOND_TRUST_PROXY === '1',
      sweepIntervalMs: 60_000,
    },
    { logger: ['log', 'error', 'warn'], shutdownHooks: true },
  );

  log.log('application started');

  step('checking for a first admin');
  const email = process.env.BOND_BOOTSTRAP_EMAIL;
  if (email) {
    try {
      const token = await app.accounts.bootstrapAdmin(email);
      // The first admin signs in through the staff app, never the customer dashboard.
      if (token) console.log(`\nFirst-run setup: open this link once to create the admin password for ${email}:\n  ${staffUrl}/invite#token=${token}\n(valid for 7 days)\n`);
    } catch (e) {
      console.error('Could not create the first admin:', (e as Error).message);
    }
  } else if ((await app.mongo.users.count({ role: 'admin', passwordHash: { $ne: null } })) === 0) {
    console.warn('\nNo admin exists yet. Restart with BOND_BOOTSTRAP_EMAIL=you@example.com to get a one-time setup link.\n');
  }

  step(`opening port ${port}`);
  const actual = await app.listen(port);
  clearInterval(heartbeat);
  log.log(`Ready: listening on port ${actual}, started in ${took(Date.now() - startedAt)}`);
  console.log(`Bond API running at http://localhost:${actual}`);
}

main().catch((err) => {
  log.error(`Startup failed while ${phase} (${took(Date.now() - startedAt)} after start): ${err instanceof Error ? err.message : String(err)}`);
  for (const hint of startupHints(err)) log.error(`Likely cause: ${hint}`);
  console.error(err);
  process.exit(1);
});
