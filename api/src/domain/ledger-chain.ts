import { LedgerEntry } from '../storage/db.types';
import { canonical, sha256 } from './canonical';

export const GENESIS = '0'.repeat(64);

export interface EntryInput {
  agentId: string;
  txId?: string | null;
  type: string;
  data?: Record<string, unknown>;
  ts: number;
  reqHash?: string | null;
}

// Per-agent, append-only, hash-chained audit log. Each entry commits to the previous
// one, so editing or deleting history breaks every hash after it. This is what the
// arbiter treats as evidence, and what an owner shows an auditor.
//
// `previous` is the last entry of the chain so far (just its seq and hash), or null for a brand-new chain.
export function buildEntry(previous: { seq: number; hash: string } | null, input: EntryInput): LedgerEntry {
  const prevHash = previous ? previous.hash : GENESIS;
  const body = {
    seq: previous ? previous.seq + 1 : 0, agentId: input.agentId, txId: input.txId ?? null, type: input.type,
    data: input.data ?? {}, ts: input.ts, reqHash: input.reqHash ?? null,
  };
  return { ...body, prevHash, hash: sha256(prevHash + canonical(body)) };
}

export function nextEntry(chain: LedgerEntry[], input: EntryInput): LedgerEntry {
  return buildEntry(chain.length ? chain[chain.length - 1] : null, input);
}

export interface ChainCheck { ok: boolean; length: number; brokenAt: number | null; headHash: string | null }

export function verifyChain(chain: LedgerEntry[] = []): ChainCheck {
  let prev = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const { prevHash, hash, ...body } = chain[i];
    if (body.seq !== i || prevHash !== prev || sha256(prev + canonical(body)) !== hash) {
      return { ok: false, length: chain.length, brokenAt: i, headHash: null };
    }
    prev = hash;
  }
  return { ok: true, length: chain.length, brokenAt: null, headHash: prev };
}
