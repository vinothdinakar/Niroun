// Prints the current two-factor code for a demo staff account, so you can sign in without a phone.
//   npm run demo:code -- admin@bond.test
// Reads demo/demo-users.json (created by `npm run demo`). Local demo only.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { totpCode, STEP_SECONDS } from '../dist/domain/totp.js';

const file = join(dirname(fileURLToPath(import.meta.url)), 'demo-users.json');
if (!existsSync(file)) {
  console.error('demo/demo-users.json not found. Run `npm run demo` once first.');
  process.exit(1);
}
const email = process.argv[2];
const users = JSON.parse(readFileSync(file, 'utf8')).users.filter((u) => u.totpSecret);
const user = users.find((u) => u.email === email);
if (!user) {
  console.error(`Usage: npm run demo:code -- <email>\nStaff accounts with two-factor: ${users.map((u) => u.email).join(', ') || '(none yet, run `npm run demo`)'}`);
  process.exit(1);
}
const now = Date.now();
const left = STEP_SECONDS - (Math.floor(now / 1000) % STEP_SECONDS);
console.log(`${totpCode(user.totpSecret, now)}   (${user.email}, valid for about ${left}s)`);
