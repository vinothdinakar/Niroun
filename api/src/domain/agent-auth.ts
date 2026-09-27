import { createPublicKey, verify } from 'node:crypto';
import { sha256 } from './canonical';

// Agent identity = Ed25519 keypair. The agent id is derived from the public key,
// so an id can never be claimed by someone who doesn't hold the private key.
export const agentIdFromKey = (publicKeyB64: string): string =>
  'agt_' + sha256(Buffer.from(publicKeyB64, 'base64url')).slice(0, 20);

// Every request is signed over: method, path+query, timestamp, nonce, sha256(body).
// NOTE: sdk/index.js builds the same string. Keep them in sync.
export const signingString = (p: { method: string; path: string; timestamp: number | string; nonce: string; body?: string }): string =>
  [p.method.toUpperCase(), p.path, String(p.timestamp), p.nonce, sha256(p.body ?? '')].join('\n');

export function verifySignature(publicKeyB64: string, message: string, signatureB64: string): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyB64, 'base64url'), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(message), key, Buffer.from(signatureB64, 'base64url'));
  } catch {
    return false;
  }
}

// Replay protection: a (agent, nonce) pair may be used once inside the freshness window.
export class NonceCache {
  private seen = new Map<string, number>();
  constructor(private windowMs = 10 * 60 * 1000) {}

  use(key: string, ts: number, now: number): boolean {
    for (const [k, t] of this.seen) {
      if (t < now - this.windowMs) this.seen.delete(k);
      else break;
    }
    if (this.seen.has(key)) return false;
    this.seen.set(key, ts);
    return true;
  }
}
