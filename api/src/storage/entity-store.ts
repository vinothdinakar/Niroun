import { Document, Filter, FindOptions, Sort } from 'mongodb';
import type { MongoService } from './mongo.service';

interface Hooks<T> {
  /** Extra stored-only fields derived from the entity (e.g. an index key). */
  toDoc?: (entity: T) => Document;
  /** Remove stored-only fields before the entity goes back to the caller. */
  fromDoc?: (doc: Document) => void;
}

// A typed collection of entities that have a string `id`. The id is stored as Mongo's `_id`, so it needs no
// second index. Every call joins the current transaction (see MongoService.transaction) when there is one.
export class EntityStore<T extends { id: string }> {
  constructor(
    private readonly mongo: MongoService,
    readonly name: string,
    private readonly hooks: Hooks<T> = {},
  ) {}

  private get col() {
    return this.mongo.db.collection<Document>(this.name);
  }

  private hydrate(doc: Document): T {
    const { _id, ...rest } = doc;
    this.hooks.fromDoc?.(rest);
    return { id: _id as string, ...rest } as unknown as T;
  }

  private dehydrate(entity: T): Document {
    const { id, ...rest } = entity;
    return { ...rest, ...(this.hooks.toDoc?.(entity) ?? {}) };
  }

  async get(id: string): Promise<T | null> {
    const doc = await this.col.findOne({ _id: id as never }, this.mongo.tx);
    return doc ? this.hydrate(doc) : null;
  }

  async getMany(ids: string[]): Promise<T[]> {
    if (!ids.length) return [];
    const docs = await this.col.find({ _id: { $in: ids as never[] } }, this.mongo.tx).toArray();
    return docs.map((d) => this.hydrate(d));
  }

  async find(filter: Filter<Document> = {}, opts: { sort?: Sort; limit?: number } = {}): Promise<T[]> {
    const options: FindOptions = { ...this.mongo.tx, sort: opts.sort, limit: opts.limit };
    const docs = await this.col.find(filter, options).toArray();
    return docs.map((d) => this.hydrate(d));
  }

  async findOne(filter: Filter<Document>): Promise<T | null> {
    const doc = await this.col.findOne(filter, this.mongo.tx);
    return doc ? this.hydrate(doc) : null;
  }

  async count(filter: Filter<Document> = {}): Promise<number> {
    return this.col.countDocuments(filter, this.mongo.tx);
  }

  /**
   * Atomically update the (first) document matching `filter`. Returns how many matched: 0 means nobody changed anything,
   * which is how compare-and-set works ("mark used, but only if it isn't used yet").
   */
  async updateOne(filter: Filter<Document>, update: Document): Promise<number> {
    const res = await this.col.updateOne(filter, update, this.mongo.tx);
    return res.matchedCount;
  }

  async insert(entity: T): Promise<void> {
    await this.col.insertOne({ _id: entity.id as never, ...this.dehydrate(entity) }, this.mongo.tx);
  }

  /** Write the whole entity back. Inside a transaction, a concurrent change to the same document makes one side retry. */
  async save(entity: T): Promise<void> {
    const res = await this.col.replaceOne({ _id: entity.id as never }, this.dehydrate(entity), this.mongo.tx);
    if (res.matchedCount === 0) throw new Error(`${this.name}/${entity.id} disappeared before it could be saved`);
  }
}
