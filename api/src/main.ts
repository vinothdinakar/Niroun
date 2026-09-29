import { join } from 'node:path';
import { createApp } from './bootstrap';
import { DiskFileStore, openGcsBucket } from './storage/file-store';

// Starts the API from environment variables. See api/README.md for the full list.
async function main(): Promise<void> {
  const port = Number(process.env.PORT) || 4100;
  // Two separate frontends, two separate origins: the customer dashboard (signup verify links point here)
  // and the staff-only admin app (the first-run admin link points here). Both must be trusted origins, since
  // both proxy /v1/* writes through to this API with a session cookie.
  const dashboardUrl = process.env.BOND_PUBLIC_URL || 'http://localhost:3300';
  const staffUrl = process.env.BOND_STAFF_URL || 'http://localhost:3400';
  // KYB/KYC evidence: a private Google Cloud Storage bucket in production. Without one, dev falls back to a local folder.
  const bucket = process.env.BOND_GCS_BUCKET;
  if (!bucket) console.warn('BOND_GCS_BUCKET is not set: verification documents are stored in ./data/uploads (development only).');
  const fileStore = bucket ? await openGcsBucket(bucket) : new DiskFileStore(join(__dirname, '..', 'data', 'uploads'));

  const app = await createApp(
    {
      fileStore,
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

  const actual = await app.listen(port);
  console.log(`Bond API running at http://localhost:${actual}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
