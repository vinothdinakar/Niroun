import { Injectable } from '@nestjs/common';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from './clock.service';
import { LedgerEntry, Tx } from '../storage/db.types';
import { ChainCheck, buildEntry, verifyChain } from '../domain/ledger-chain';

// Per-agent, hash-chained audit log (see domain/ledger-chain.ts for the chain itself), one document per entry.
//
// The document's _id is `${agentId}:${seq}`. Two requests that race to append to the same agent's chain both compute
// the same next number, and the database's uniqueness guarantee lets exactly one win; the loser's whole operation is
// rolled back and retried by MongoService.transaction(), this time seeing the winner's entry. That is what keeps
// the chain gap-free and unforked without any locks.
@Injectable()
export class LedgerService {
  constructor(private readonly mongo: MongoService, private readonly clock: ClockService) {}

  private get col() {
    return this.mongo.col('ledger');
  }

  /** Append an entry to `agentId`'s chain. `proof.reqHash` links it to the signed request that caused it. */
  async log(agentId: string, type: string, data: Record<string, unknown> = {}, txId: string | null = null, proof: { reqHash?: string } | null = null): Promise<LedgerEntry> {
    const last = await this.col.findOne({ agentId }, { sort: { seq: -1 }, projection: { seq: 1, hash: 1 }, ...this.mongo.tx });
    const entry = buildEntry(last ? { seq: last.seq as number, hash: last.hash as string } : null, {
      agentId, txId, type, data, ts: this.clock.now(), reqHash: proof?.reqHash ?? null,
    });
    await this.col.insertOne({ _id: `${agentId}:${entry.seq}` as never, ...entry }, this.mongo.tx);
    return entry;
  }

  private strip(doc: Record<string, unknown>): LedgerEntry {
    const { _id, ...entry } = doc;
    return entry as unknown as LedgerEntry;
  }

  async chain(agentId: string): Promise<LedgerEntry[]> {
    const docs = await this.col.find({ agentId }, { sort: { seq: 1 }, ...this.mongo.tx }).toArray();
    return docs.map((d) => this.strip(d));
  }

  async verify(agentId: string): Promise<ChainCheck> {
    return verifyChain(await this.chain(agentId));
  }

  /** Both parties' entries for one deal, in time order: the evidence the arbiter reads. */
  async entriesForTx(tx: Tx): Promise<LedgerEntry[]> {
    // buyer's entries, then seller's, then a stable sort by time: the same tie-breaking the arbiter has always seen
    const all: LedgerEntry[] = [];
    for (const id of [tx.buyerId, tx.sellerId]) {
      const docs = await this.col.find({ agentId: id, txId: tx.id }, { sort: { seq: 1 }, ...this.mongo.tx }).toArray();
      all.push(...docs.map((d) => this.strip(d)));
    }
    return all.sort((a, b) => a.ts - b.ts);
  }

  async integrityOf(tx: Tx): Promise<{ buyer: boolean; seller: boolean }> {
    return { buyer: (await this.verify(tx.buyerId)).ok, seller: (await this.verify(tx.sellerId)).ok };
  }

  async recent(agentId: string, limit = 200): Promise<{ verification: ChainCheck; entries: LedgerEntry[] }> {
    const chain = await this.chain(agentId);
    return { verification: verifyChain(chain), entries: chain.slice(-limit).reverse() };
  }

  async countByType(agentIds: string[], type: string): Promise<number> {
    if (!agentIds.length) return 0;
    return this.col.countDocuments({ agentId: { $in: agentIds }, type }, this.mongo.tx);
  }
}
