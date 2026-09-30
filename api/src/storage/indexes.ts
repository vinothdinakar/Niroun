import { Db } from 'mongodb';

// Every index Bond relies on, created idempotently at start-up. Two kinds matter:
//   - UNIQUE indexes are correctness: they are what stops two concurrent requests from creating the same
//     user, the same company, or the same ledger sequence number.
//   - the others make the common queries (a customer's deals, the review queue, an agent's history) fast.
// TTL indexes only garbage-collect expired rows; validity is always checked in code. They use real (wall-clock)
// dates with generous slack, so they never fight a test's or the demo's virtual clock.
export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true, name: 'users_email_unique' }),
    db.collection('users').createIndex({ orgId: 1 }, { name: 'users_org' }),
    db.collection('users').createIndex({ inviteHash: 1 }, { name: 'users_invite', partialFilterExpression: { inviteHash: { $type: 'string' } } }),
    db.collection('orgs').createIndex({ nameKey: 1 }, { unique: true, name: 'orgs_name_unique' }),

    db.collection('agents').createIndex({ orgId: 1 }, { name: 'agents_org' }),

    db.collection('txs').createIndex({ buyerId: 1, createdAt: -1 }, { name: 'txs_buyer' }),
    db.collection('txs').createIndex({ sellerId: 1, status: 1 }, { name: 'txs_seller_status' }),
    db.collection('txs').createIndex({ status: 1, updatedAt: -1 }, { name: 'txs_status' }),
    db.collection('quotes').createIndex({ buyerId: 1 }, { name: 'quotes_buyer' }),
    db.collection('disputes').createIndex({ status: 1 }, { name: 'disputes_status' }),
    db.collection('disputes').createIndex({ txId: 1 }, { name: 'disputes_tx' }),

    // the ledger's _id is `${agentId}:${seq}`, which is what makes the chain race-proof (see LedgerService)
    db.collection('ledger').createIndex({ agentId: 1, seq: 1 }, { unique: true, name: 'ledger_agent_seq_unique' }),
    db.collection('ledger').createIndex({ txId: 1 }, { name: 'ledger_tx' }),
    db.collection('ledger').createIndex({ agentId: 1, type: 1 }, { name: 'ledger_agent_type' }),

    db.collection('outcomes').createIndex({ agentId: 1 }, { name: 'outcomes_agent' }),
    db.collection('outcomes').createIndex({ agentId: 1, cp: 1, kind: 1 }, { name: 'outcomes_pair' }),

    // the wallet's ledger, like the agents': _id is `${orgId}:${seq}`; the `agentId` field of each entry holds the org id
    db.collection('wallet_ledger').createIndex({ agentId: 1, seq: 1 }, { unique: true, name: 'wallet_ledger_org_seq_unique' }),
    db.collection('wallet_tx').createIndex({ orgId: 1, createdAt: -1 }, { name: 'wallet_tx_org' }),
    db.collection('wallet_tx').createIndex({ 'stripe.sessionId': 1 }, { name: 'wallet_tx_session', sparse: true }),
    db.collection('wallet_tx').createIndex({ 'stripe.payoutId': 1 }, { name: 'wallet_tx_payout', sparse: true }),
    db.collection('wallet_accounts').createIndex({ stripeAccountId: 1 }, { unique: true, name: 'wallet_accounts_stripe_unique' }),

    db.collection('audit').createIndex({ ts: -1 }, { name: 'audit_recent' }),

    db.collection('verification_requests').createIndex({ orgId: 1, submittedAt: -1 }, { name: 'verification_requests_org' }),
    db.collection('verification_requests').createIndex({ status: 1, submittedAt: 1 }, { name: 'verification_requests_status' }),
    db.collection('verification_documents').createIndex({ orgId: 1, requestId: 1 }, { name: 'verification_documents_org' }),
    db.collection('verification_documents').createIndex({ requestId: 1, purgedAt: 1, uploadedAt: 1 }, { name: 'verification_documents_purge' }),

    db.collection('sessions').createIndex({ userId: 1 }, { name: 'sessions_user' }),
    db.collection('sessions').createIndex({ gcAt: 1 }, { expireAfterSeconds: 0, name: 'sessions_gc' }),
    db.collection('signups').createIndex({ verifyHash: 1 }, { name: 'signups_token' }),
    db.collection('signups').createIndex({ gcAt: 1 }, { expireAfterSeconds: 0, name: 'signups_gc' }),
    db.collection('enrollments').createIndex({ gcAt: 1 }, { expireAfterSeconds: 0, name: 'enrollments_gc' }),
    db.collection('nonces').createIndex({ gcAt: 1 }, { expireAfterSeconds: 0, name: 'nonces_gc' }),
  ]);
}
