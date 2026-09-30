import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ClientSession, Collection, Db, Document, MongoClient, MongoServerError } from 'mongodb';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { Agent, Dispute, Org, Quote, Tx, User, VerificationDocument, VerificationRequest } from './db.types';
import { EntityStore } from './entity-store';
import { ensureIndexes } from './indexes';
import { redactUrl, took } from '../startup';

export const POOL_ID = 'main';
const INITIAL_CAPITAL_CENTS = 5_000_000; // simulated: $50,000 of reserve capital

// The single gateway to MongoDB: connection, indexes, and transactions.
//
// TRANSACTIONS. Wrap a business operation in `mongo.transaction(async () => { ... })`. Every query made inside it
// (through the stores below, or by asking `mongo.session` for the current session) joins the same transaction
// automatically: the "current session" travels in an AsyncLocalStorage, so no method has to pass it along.
// Nested calls join the outer transaction. MongoDB transactions need a replica set (single-node is fine).
@Injectable()
export class MongoService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('Mongo');
  private readonly als = new AsyncLocalStorage<ClientSession>();
  client!: MongoClient;
  db!: Db;

  // entities with a string `id` (stored as _id)
  readonly agents = new EntityStore<Agent>(this, 'agents');
  readonly quotes = new EntityStore<Quote>(this, 'quotes');
  readonly txs = new EntityStore<Tx>(this, 'txs');
  readonly disputes = new EntityStore<Dispute>(this, 'disputes');
  readonly users = new EntityStore<User>(this, 'users');
  // "Acme Corp", "ACME  corp." and "acme-corp" are the same company as far as name squatting goes: a unique index on nameKey enforces it
  readonly orgs = new EntityStore<Org>(this, 'orgs', {
    toDoc: (org) => ({ nameKey: orgNameKey(org.name) }),
    fromDoc: (doc) => { delete doc.nameKey; delete doc.contactEmail; }, // contactEmail was dropped from the profile; old values are no longer served
  });
  readonly verificationRequests = new EntityStore<VerificationRequest>(this, 'verification_requests');
  readonly verificationDocuments = new EntityStore<VerificationDocument>(this, 'verification_documents');

  constructor(@Inject(BOND_OPTIONS) private readonly options: BondOptions) {}

  async onModuleInit(): Promise<void> {
    const t0 = Date.now();
    this.log.log(`connecting to ${redactUrl(this.options.mongoUrl)}, database "${this.options.mongoDb}" (gives up after ${took(this.options.mongoTimeoutMs)})`);
    this.client = new MongoClient(this.options.mongoUrl, {
      ignoreUndefined: true, // optional fields left undefined are omitted, not stored as null
      serverSelectionTimeoutMS: this.options.mongoTimeoutMs,
    });
    try {
      await this.client.connect();
    } catch (e) {
      throw new Error(
        `Cannot reach MongoDB at ${redactUrl(this.options.mongoUrl)} after ${took(Date.now() - t0)}: ${(e as Error).message}
` +
        'Check BOND_MONGO_URL. For the local dev database run `npm run db:start`; on Atlas, Network Access must allow this host and the user and password must be right. It must be a replica set (transactions need one).',
      );
    }
    this.log.log(`connected in ${took(Date.now() - t0)}`);
    try {
      const hello = await this.client.db('admin').command({ hello: 1 });
      this.log.log(`server: replica set "${hello.setName ?? 'none'}", primary ${hello.isWritablePrimary ? 'yes' : 'no'}, max wire version ${hello.maxWireVersion}`);
      if (!hello.setName) this.log.warn('this MongoDB is not a replica set: transactions will fail. Point BOND_MONGO_URL at a replica set (Atlas always is).');
    } catch (e) {
      this.log.warn(`could not read the server's topology: ${(e as Error).message}`);
    }
    this.db = this.client.db(this.options.mongoDb);

    const t1 = Date.now();
    this.log.log('creating indexes (already existing ones are left as they are)');
    try {
      await ensureIndexes(this.db);
    } catch (e) {
      throw new Error(`Could not create the database indexes after ${took(Date.now() - t1)}: ${(e as Error).message}`);
    }
    this.log.log(`indexes ready in ${took(Date.now() - t1)}`);
    await this.db.collection(POOL).updateOne(
      { _id: POOL_ID as never },
      { $setOnInsert: { capitalCents: INITIAL_CAPITAL_CENTS, premiumsCents: 0, refundsCents: 0, payoutsCents: 0, version: 0 } },
      { upsert: true },
    );
    this.log.log(`database ready in ${took(Date.now() - t0)}`);
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.client) return;
    if (this.options.dropDbOnClose) await this.db.dropDatabase().catch(() => undefined);
    await this.client.close();
  }

  /** A raw collection, for the shapes that aren't simple entities (ledger, outcomes, sessions, ...). */
  col<T extends Document = Document>(name: string): Collection<T> {
    return this.db.collection<T>(name);
  }

  /** The transaction the current operation is running in, if any. Pass as `{ session }` to driver calls. */
  get session(): ClientSession | undefined {
    return this.als.getStore();
  }

  /** Driver options that enlist a call in the current transaction (an empty object when there isn't one). */
  get tx(): { session?: ClientSession } {
    const session = this.als.getStore();
    return session ? { session } : {};
  }

  /**
   * Run `fn` atomically. All-or-nothing: if it throws, everything it wrote is rolled back.
   * MongoDB retries transient conflicts by itself; we also retry when two requests race to append to the same
   * agent's ledger (the unique (agent, seq) key rejects the loser, who simply tries again).
   */
  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (this.als.getStore()) return fn(); // join the surrounding transaction
    for (let attempt = 1; ; attempt++) {
      const session = this.client.startSession();
      try {
        let result!: T;
        await this.als.run(session, () =>
          session.withTransaction(
            async () => { result = await fn(); },
            { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' },
          ),
        );
        return result;
      } catch (e) {
        if (attempt < 6 && isLedgerRace(e)) continue;
        throw e;
      } finally {
        await session.endSession();
      }
    }
  }
}

const POOL = 'pool';

export const orgNameKey = (n: string): string => String(n).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** True for a duplicate-key error on the ledger (someone else appended the same sequence number first). */
function isLedgerRace(e: unknown): boolean {
  return e instanceof MongoServerError && e.code === 11000 && /ledger/.test(e.message);
}

export const isDuplicateKey = (e: unknown): boolean => e instanceof MongoServerError && e.code === 11000;

const redact = (url: string): string => url.replace(/\/\/([^@/]+)@/, '//***@');
