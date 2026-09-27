// Bond SDK. Everything an agent developer needs to make an agent a good citizen:
//
//   const bond = await BondClient.register({ baseUrl, name: 'ProcureBot', owner: 'Acme',
//                                            policy: { perTxLimitCents: 50_000 } });
//   const { transaction } = await bond.purchase({ counterparty, spec, priceCents, category });
//   await bond.pay(transaction.id);
//   ...
//
// Requests are signed with the agent's Ed25519 key. Nothing secret ever leaves the process.

import { generateKeyPairSync, createPrivateKey, sign, randomBytes, createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export class BondError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `HTTP ${status}`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

// Thrown by purchase() when Bond (or the agent's own mandate) says no.
export class BondDeclined extends Error {
  constructor(reasons) {
    super('Declined: ' + reasons.map((r) => r.message).join('; '));
    this.reasons = reasons;
    this.codes = reasons.map((r) => r.code);
  }
}

// Must match signingString() in src/auth.js.
const signingString = ({ method, path, timestamp, nonce, body }) =>
  [method.toUpperCase(), path, String(timestamp), nonce, sha256(body ?? '')].join('\n');

export class BondClient {
  constructor({ baseUrl, keys, agentId, now = Date.now }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.keys = keys;
    this.agentId = agentId;
    this.now = now;
    this.privateKey = createPrivateKey({ key: Buffer.from(keys.privateKey, 'base64url'), format: 'der', type: 'pkcs8' });
  }

  static generateKeys() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    return {
      publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
      privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64url'),
    };
  }

  // Pass `enrollmentCode` (created by your organisation in the console) to link the agent to your
  // organisation: its owner is then verified, and its mandate is managed by your admins.
  static async register({ baseUrl, name, owner, policy, enrollmentCode, keys = BondClient.generateKeys(), now = Date.now }) {
    const agentId = 'agt_' + sha256(Buffer.from(keys.publicKey, 'base64url')).slice(0, 20);
    const client = new BondClient({ baseUrl, keys, agentId, now });
    await client.#request('POST', '/v1/agents', { name, owner, publicKey: keys.publicKey, policy, enrollmentCode });
    return client;
  }

  async #request(method, path, body) {
    const raw = body === undefined ? '' : JSON.stringify(body);
    const timestamp = this.now();
    const nonce = randomBytes(12).toString('base64url');
    const signature = sign(null, Buffer.from(signingString({ method, path, timestamp, nonce, body: raw })), this.privateKey).toString('base64url');
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Bond-Agent': this.agentId,
        'X-Bond-Timestamp': String(timestamp),
        'X-Bond-Nonce': nonce,
        'X-Bond-Signature': signature,
      },
      body: raw || undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new BondError(res.status, json);
    return json;
  }

  // ---- identity & mandate ----
  me() { return this.#request('GET', '/v1/me'); }
  // Only works for agents not linked to an organisation; otherwise the owner controls the mandate.
  setPolicy(patch) { return this.#request('PUT', '/v1/me/policy', patch); }
  // Reads are signed too: lookups require an authenticated agent.
  score(agentId = this.agentId) { return this.#request('GET', `/v1/agents/${agentId}`); }
  transaction(txId) { return this.#request('GET', `/v1/transactions/${txId}`); }

  // ---- buying ----
  quote({ counterparty, amountCents, category = 'other', coverageCents }) {
    return this.#request('POST', '/v1/quotes', { counterparty, amountCents, category, coverageCents });
  }

  // Guarded purchase: mandate check + counterparty risk check + bond, in one call.
  // Throws BondDeclined (with machine-readable codes) if the agent shouldn't proceed.
  async purchase({ counterparty, spec, priceCents, category = 'other', deliverBy, coverageCents }) {
    const q = await this.quote({ counterparty, amountCents: priceCents, category, coverageCents });
    if (q.decision !== 'approved') throw new BondDeclined(q.reasons);
    const { transaction } = await this.#request('POST', '/v1/transactions', {
      quoteId: q.quote.id,
      terms: { spec, priceCents, deliverBy: deliverBy ?? this.now() + 24 * 3600 * 1000 },
    });
    return { transaction, quote: q.quote };
  }

  #event(txId, type, data) {
    return this.#request('POST', `/v1/transactions/${txId}/events`, { type, data }).then((r) => r.transaction);
  }
  pay(tx) { return this.#event(tx.id, 'payment', { amountCents: tx.amountCents }); }
  cancel(txId, reason) { return this.#event(txId, 'cancel', { reason }); }
  // Buyer confirms what they actually received. Pass the item (or its text) so the ledger records its hash.
  receipt(txId, { item, ok = true, note } = {}) {
    return this.#event(txId, 'receipt', { ok, specHash: item === undefined ? undefined : sha256(item), note });
  }
  dispute(txId, reason) { return this.#request('POST', `/v1/transactions/${txId}/disputes`, { reason }); }

  // ---- selling ----
  async accept(txId, termsHash) {
    termsHash ??= (await this.transaction(txId)).termsHash;
    return this.#event(txId, 'accept', { termsHash });
  }
  decline(txId, reason) { return this.#event(txId, 'decline', { reason }); }
  // Seller attests exactly what was delivered; the hash is what the arbiter compares to the agreed spec.
  deliver(txId, item, note) { return this.#event(txId, 'deliver', { specHash: sha256(item), note }); }
}
