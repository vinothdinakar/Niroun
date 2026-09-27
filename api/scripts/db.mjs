// Runs Bond's own local MongoDB: a single-node replica set (transactions need one) bound to 127.0.0.1.
//
//   npm run db:start     start it (no-op if it is already up)
//   npm run db:status    is it up, and is it a primary?
//   npm run db:stop      shut it down cleanly
//
// It is a DEV database: no authentication, localhost only. It uses its own port (27018) and its own data
// folder (api/data/mongo), so it never touches any other MongoDB on this machine. For production use MongoDB Atlas
// or your own secured cluster and set BOND_MONGO_URL.
//
// Which `mongod` it runs, in order: $MONGOD_PATH, `mongod` on PATH, or the newest binary in ~/.cache/mongodb-binaries.
// No MongoDB installed? `docker compose up -d` (see docker-compose.yml) gives you the same thing.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, openSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoClient } = require('mongodb');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BOND_MONGO_PORT || 27018);
const REPLSET = 'bond0';
const DBPATH = join(ROOT, 'data', 'mongo');
const LOGFILE = join(ROOT, 'data', 'mongod.log');
const DIRECT = `mongodb://127.0.0.1:${PORT}/?directConnection=true`;

function findMongod() {
  if (process.env.MONGOD_PATH && existsSync(process.env.MONGOD_PATH)) return process.env.MONGOD_PATH;
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['mongod'], { encoding: 'utf8' });
  if (probe.status === 0) return probe.stdout.split(/\r?\n/)[0].trim();
  const cache = join(homedir(), '.cache', 'mongodb-binaries');
  if (existsSync(cache)) {
    const found = readdirSync(cache).filter((f) => /^mongod/.test(f)).map((f) => join(cache, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (found.length) return found[0];
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ping() {
  const c = new MongoClient(DIRECT, { serverSelectionTimeoutMS: 1200, connectTimeoutMS: 1200 });
  try {
    await c.connect();
    const hello = await c.db('admin').command({ hello: 1 });
    return { up: true, primary: !!hello.isWritablePrimary, setName: hello.setName ?? null };
  } catch {
    return { up: false, primary: false, setName: null };
  } finally {
    await c.close().catch(() => {});
  }
}

async function initiateReplicaSet() {
  const c = new MongoClient(DIRECT, { serverSelectionTimeoutMS: 5000 });
  await c.connect();
  try {
    await c.db('admin').command({ replSetGetStatus: 1 });
  } catch (e) {
    if (e.code === 94 || /no replset config/i.test(e.message)) {
      await c.db('admin').command({ replSetInitiate: { _id: REPLSET, members: [{ _id: 0, host: `127.0.0.1:${PORT}` }] } });
    } else {
      throw e;
    }
  } finally {
    await c.close();
  }
}

async function start() {
  let s = await ping();
  if (!s.up) {
    const bin = findMongod();
    if (!bin) {
      console.error('No mongod found. Install MongoDB Community, set MONGOD_PATH, or run `docker compose up -d`.');
      process.exit(1);
    }
    mkdirSync(DBPATH, { recursive: true });
    const log = openSync(LOGFILE, 'a');
    const child = spawn(bin, [
      '--port', String(PORT), '--dbpath', DBPATH, '--replSet', REPLSET, '--bind_ip', '127.0.0.1',
      '--wiredTigerCacheSizeGB', '0.25', // keep the dev database small: it shares a laptop with everything else
    ], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
    child.unref();
    console.log(`starting ${bin} on 127.0.0.1:${PORT} ...`);
    for (let i = 0; i < 60 && !(s = await ping()).up; i++) await sleep(500);
    if (!s.up) {
      console.error(`mongod did not come up. See ${LOGFILE}`);
      process.exit(1);
    }
  }
  await initiateReplicaSet();
  for (let i = 0; i < 60 && !(s = await ping()).primary; i++) await sleep(500);
  if (!s.primary) {
    console.error('replica set did not elect a primary in time');
    process.exit(1);
  }
  console.log(`MongoDB ready: mongodb://127.0.0.1:${PORT}/?replicaSet=${REPLSET}  (replica set ${s.setName}, primary)`);
}

async function stop() {
  const s = await ping();
  if (!s.up) return console.log('not running');
  const c = new MongoClient(DIRECT, { serverSelectionTimeoutMS: 3000 });
  await c.connect();
  try {
    await c.db('admin').command({ shutdown: 1, force: true });
  } catch {
    /* the server closes the connection as it exits: expected */
  } finally {
    await c.close().catch(() => {});
  }
  console.log('stopped');
}

const cmd = process.argv[2];
if (cmd === 'start' || cmd === 'ensure') await start();
else if (cmd === 'stop') await stop();
else if (cmd === 'status') {
  const s = await ping();
  console.log(s.up ? `running on port ${PORT} (${s.setName ?? 'standalone'}${s.primary ? ', primary' : ''})` : `not running on port ${PORT}`);
  process.exit(s.up ? 0 : 1);
} else {
  console.log('usage: node scripts/db.mjs start|stop|status');
}
