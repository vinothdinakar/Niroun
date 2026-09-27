import { LedgerEntry, Tx, Verdict } from '../storage/db.types';
import { sha256 } from './canonical';

// Automated dispute resolution. It reads only signed, hash-chained evidence from
// both parties' ledgers and applies deterministic rules. Anything it can't prove
// either way goes to a human ("needs_review") rather than being guessed.
//
// This is the seam where an LLM arbiter plugs in later: same input, same verdict shape,
// but the rules below stay as the fast path and the audit baseline.

export const GRACE_MS = 60 * 60 * 1000;
const iso = (t: number) => new Date(t).toISOString();

export interface ArbiterResult { verdict: Verdict; rule: string; reasons: string[] }
export interface ArbiterInput {
  tx: Pick<Tx, 'terms'>;
  entries: Pick<LedgerEntry, 'type' | 'data' | 'ts'>[];
  integrity: { buyer: boolean; seller: boolean };
  now: number;
}

export function arbitrate({ tx, entries, integrity, now }: ArbiterInput): ArbiterResult {
  const last = (type: string) => [...entries].reverse().find((e) => e.type === type);
  const out = (verdict: Verdict, rule: string, ...reasons: string[]): ArbiterResult => ({ verdict, rule, reasons });

  if (!integrity.seller) return out('seller_fault', 'LEDGER_TAMPERED', "Seller's audit ledger failed hash-chain verification; their evidence is inadmissible.");
  if (!integrity.buyer) return out('buyer_fault', 'LEDGER_TAMPERED', "Buyer's audit ledger failed hash-chain verification; their evidence is inadmissible.");

  const accept = last('accept');
  const payment = last('payment');
  const deliver = last('deliver');
  const receipt = last('receipt');
  const expected = sha256(tx.terms.spec);

  if (!accept) return out('not_covered', 'NOT_ACCEPTED', 'The seller never accepted the terms, so no coverage was active.');
  if (!payment) return out('not_covered', 'NOT_FUNDED', 'No payment was recorded, so no coverage was active.');

  if (!deliver) {
    if (now > tx.terms.deliverBy) {
      return out('seller_fault', 'NON_DELIVERY',
        `Payment recorded at ${iso(payment.ts)}. No delivery recorded by the deadline (${iso(tx.terms.deliverBy)}).`);
    }
    return out('not_covered', 'PREMATURE', 'The delivery deadline has not passed and no delivery was rejected.');
  }

  if (deliver.data.specHash !== expected) {
    return out('seller_fault', 'NON_CONFORMING',
      "The seller's own signed delivery record does not match the agreed spec hash.",
      `expected ${expected.slice(0, 12)}..., seller attested ${String(deliver.data.specHash).slice(0, 12)}...`);
  }

  if (deliver.ts > tx.terms.deliverBy + GRACE_MS) {
    return out('needs_review', 'LATE_DELIVERY',
      `Delivery conformed to spec but arrived ${Math.round((deliver.ts - tx.terms.deliverBy) / 60000)} minutes after the deadline. Whether lateness caused loss is a judgment call.`);
  }

  if (receipt) {
    if (receipt.data.specHash === expected) {
      return out('buyer_fault', 'UNFOUNDED_CLAIM',
        "The buyer's own signed receipt records an item that matches the agreed spec, yet a claim was filed.");
    }
    return out('needs_review', 'CONFLICTING_EVIDENCE',
      'Seller attests a conforming delivery; buyer reports a different or missing item. Neither side can be proven from the ledgers.');
  }

  return out('needs_review', 'DELIVERY_DISPUTED',
    'Seller attests a conforming delivery on time; buyer disputes without acknowledging receipt.');
}
