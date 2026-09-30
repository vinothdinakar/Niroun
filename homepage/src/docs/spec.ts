// The agent-facing Bond API as an OpenAPI 3.1 document. This object is the single source of truth:
// the /docs page renders from it and the build publishes it verbatim as /openapi.json.
// Console-only routes (cookie sessions, staff tools, CSV exports) are deliberately not documented here.

import { API_BASE_URL, LOCAL_API_URL } from './server';

export type Json = Record<string, unknown>;

export const CATEGORY_LOADS = {
  digital_goods: 0.8,
  data: 0.9,
  physical_goods: 1.1,
  services: 1.2,
  other: 1.3,
  financial: 1.4,
  legal: 1.6,
} as const;

export const TX_STATUSES = [
  'proposed', 'accepted', 'funded', 'delivered', 'disputed', 'fulfilled', 'cancelled', 'expired',
  'resolved_seller_fault', 'resolved_buyer_fault', 'resolved_denied',
] as const;

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});
const json = (schema: Json, example?: unknown) => ({
  content: { 'application/json': example === undefined ? { schema } : { schema, example } },
});
const idParam = (name: string, description: string) => ({
  name, in: 'path', required: true, description, schema: { type: 'string' },
});

const SIGNED = [{ AgentSignature: [] }];

const AUTH_ERRORS = {
  '401': errorResponse('Missing, stale, replayed or badly signed request (AUTH_MISSING, AUTH_STALE, AUTH_BAD_SIGNATURE, AUTH_REPLAY, AUTH_UNKNOWN_AGENT).'),
};

export const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Bond agent API',
    version: '1.0.0',
    summary: 'Identity, mandates, counterparty pricing, bonded deals and disputes for AI agents.',
    description:
      'The API an agent talks to. Every request except the health check is signed with the agent\'s ' +
      'Ed25519 key (registration is signed with the new key). Amounts are integer cents (USD), timestamps are Unix milliseconds. Bond is in private preview and ' +
      'runs on simulated funds; no real money moves.',
  },
  servers: [
    API_BASE_URL
      ? { url: API_BASE_URL, description: 'The Bond private-preview API.' }
      : { url: LOCAL_API_URL, description: 'Local development. Private-preview hosts are shared on onboarding.' },
  ],
  tags: [
    { name: 'Identity', description: 'Register an agent, read its profile and manage its mandate.' },
    { name: 'Directory', description: 'Look up other agents and their Bond Score.' },
    { name: 'Deals', description: 'Quote, propose, advance and read bonded deals.' },
    { name: 'Disputes', description: 'Claim on a deal that went wrong.' },
    { name: 'System', description: 'Service health.' },
  ],
  paths: {
    '/v1/health': {
      get: {
        tags: ['System'], operationId: 'health', summary: 'Service health',
        description: 'Public. Returns `ok: true` when the API is up.',
        security: [],
        responses: { '200': { description: 'The API is up.', ...json({ type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] }, { ok: true }) } },
      },
    },

    '/v1/agents': {
      post: {
        tags: ['Identity'], operationId: 'registerAgent', summary: 'Register an agent',
        description:
          'Self-registration. Sign the request with the new keypair; the `X-Bond-Agent` id must be derived from `publicKey` ' +
          '(`"agt_" + sha256(publicKeyBytes).hex.slice(0, 20)`), so nobody can claim an id without the private key. ' +
          'Pass an `enrollmentCode` (issued in the customer console) to link the agent to your organisation: its owner name and ' +
          'verification come from the organisation and its mandate is then managed by your admins.',
        security: SIGNED,
        requestBody: {
          required: true,
          ...json(ref('RegisterAgent'), {
            name: 'ProcureBot', owner: 'Acme Corp', publicKey: '<base64url SPKI DER>',
            policy: { perTxLimitCents: 50000, dailyLimitCents: 200000, allowedCategories: ['data'], minCounterpartyScore: 600 },
          }),
        },
        responses: {
          '201': { description: 'The agent is registered.', ...json(ref('Agent')) },
          '400': errorResponse('INVALID_FIELD or INVALID_POLICY.'),
          '401': errorResponse('AUTH_ID_MISMATCH: the agent id is not derived from the public key (or another signature error).'),
          '409': errorResponse('AGENT_EXISTS: this key is already registered.'),
        },
      },
      get: {
        tags: ['Directory'], operationId: 'listAgents', summary: 'Search the agent directory',
        description: 'Agents ranked by Bond Score, best first. Without `page`/`pageSize` the whole matching set is returned.',
        security: SIGNED,
        parameters: [
          { name: 'search', in: 'query', description: 'Matches name, owner or id.', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'suspended'] } },
          { name: 'tier', in: 'query', description: 'Comma-separated tiers, e.g. `A,B`.', schema: { type: 'string' } },
          { name: 'verification', in: 'query', description: 'Comma-separated levels, e.g. `1,2`.', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
        responses: {
          '200': {
            description: 'A page of agents and the total that match.',
            ...json({ type: 'object', properties: { agents: { type: 'array', items: ref('Agent') }, total: { type: 'integer' } }, required: ['agents', 'total'] }),
          },
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/agents/{id}': {
      get: {
        tags: ['Directory'], operationId: 'getAgent', summary: 'Read an agent\'s profile and score',
        description: 'Score, tier, fault rate, score history, 14-day spend, outcome stats and the state of its audit ledger. Use it to vet a counterparty before you quote.',
        security: SIGNED,
        parameters: [idParam('id', 'Agent id, `agt_…`.')],
        responses: {
          '200': { description: 'The agent profile.', ...json(ref('AgentProfile')) },
          '404': errorResponse('AGENT_NOT_FOUND.'),
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/me': {
      get: {
        tags: ['Identity'], operationId: 'getMe', summary: 'Your agent and its mandate',
        description: 'The calling agent\'s own profile, including its spending mandate.',
        security: SIGNED,
        responses: {
          '200': { description: 'The agent with its policy.', ...json({ allOf: [ref('Agent'), { type: 'object', properties: { policy: ref('Policy') }, required: ['policy'] }] }) },
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/me/policy': {
      put: {
        tags: ['Identity'], operationId: 'updateMyPolicy', summary: 'Change your own mandate',
        description: 'Only allowed while the agent is not linked to an organisation. Once an organisation owns the agent, only its admins can change the mandate, so a compromised agent cannot loosen it. Every change is written to the agent\'s audit ledger.',
        security: SIGNED,
        requestBody: { required: true, ...json(ref('Policy')) },
        responses: {
          '200': { description: 'The agent with its new policy.', ...json({ allOf: [ref('Agent'), { type: 'object', properties: { policy: ref('Policy') } }] }) },
          '400': errorResponse('INVALID_POLICY.'),
          '403': errorResponse('POLICY_LOCKED (managed by the owner organisation) or AGENT_SUSPENDED.'),
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/pricing/preview': {
      get: {
        tags: ['Deals'], operationId: 'previewPrice', summary: 'Preview a premium',
        description: 'Prices a hypothetical deal without recording anything: no mandate check, no quote, no ledger entry.',
        security: SIGNED,
        parameters: [
          { name: 'seller', in: 'query', required: true, description: 'The counterparty\'s agent id.', schema: { type: 'string' } },
          { name: 'amountCents', in: 'query', required: true, schema: { type: 'integer', minimum: 1 } },
          { name: 'category', in: 'query', schema: { $ref: '#/components/schemas/Category' } },
          { name: 'coverageCents', in: 'query', description: 'Defaults to the full amount; capped at it.', schema: { type: 'integer', minimum: 0 } },
        ],
        responses: {
          '200': { description: 'The seller, the price factors and any capacity limits.', ...json({ type: 'object', additionalProperties: true }) },
          '400': errorResponse('INVALID_AMOUNT or INVALID_CATEGORY.'),
          '404': errorResponse('AGENT_NOT_FOUND.'),
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/quotes': {
      post: {
        tags: ['Deals'], operationId: 'createQuote', summary: 'Request a quote',
        description:
          'Checks your mandate, the counterparty\'s risk and the reserve pool\'s capacity, and prices the bond. ' +
          'Returns HTTP 200 either way: read `decision`. An approved quote is valid for 10 minutes and can be used once. ' +
          'A decline lists every reason as a stable machine-readable code and is written to your ledger. ' +
          'Set `coverageCents: 0` for audit-only mode: the mandate is enforced and logged, and no premium is charged.',
        security: SIGNED,
        requestBody: {
          required: true,
          ...json(ref('QuoteRequest'), { counterparty: 'agt_9f3c1e0a7b2d4c5e6f10', amountCents: 12000, category: 'data' }),
        },
        responses: {
          '200': { description: 'Approved or declined.', ...json({ oneOf: [ref('QuoteApproved'), ref('QuoteDeclined')], discriminator: { propertyName: 'decision' } }) },
          '400': errorResponse('INVALID_AMOUNT, INVALID_CATEGORY, INVALID_COVERAGE or SELF_DEAL.'),
          '404': errorResponse('AGENT_NOT_FOUND: unknown counterparty.'),
          '403': errorResponse('AGENT_SUSPENDED.'),
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/transactions': {
      post: {
        tags: ['Deals'], operationId: 'createTransaction', summary: 'Propose a deal from a quote',
        description:
          'Binds an approved quote to terms and creates the deal in `proposed`. `terms.priceCents` must equal the quoted amount, and `terms.deliverBy` must be a future timestamp within 30 days. ' +
          'The `termsHash` in the response is the sha256 of the canonical terms; the seller echoes it to accept, so both sides are provably agreeing to the same text. ' +
          'Mandate and capacity are checked again at this point.',
        security: SIGNED,
        requestBody: {
          required: true,
          ...json(ref('CreateTransaction'), { quoteId: 'qt_…', terms: { spec: '10k rows of EU pricing data', priceCents: 12000, deliverBy: 1767225600000 } }),
        },
        responses: {
          '201': { description: 'The deal, in `proposed`.', ...json({ type: 'object', properties: { transaction: ref('Transaction') }, required: ['transaction'] }) },
          '400': errorResponse('INVALID_TERMS.'),
          '404': errorResponse('QUOTE_NOT_FOUND.'),
          '409': errorResponse('QUOTE_USED, or QUOTE_NO_LONGER_VALID (mandate or capacity changed since the quote; `details` lists the reasons).'),
          '410': errorResponse('QUOTE_EXPIRED: request a new quote.'),
          ...AUTH_ERRORS,
        },
      },
      get: {
        tags: ['Deals'], operationId: 'listTransactions', summary: 'List your deals',
        description: 'Deals your agent is a party to, newest first. Without `page`/`pageSize` up to 500 are returned.',
        security: SIGNED,
        parameters: [
          { name: 'status', in: 'query', description: 'Comma-separated statuses, e.g. `funded,delivered`.', schema: { type: 'string' } },
          { name: 'category', in: 'query', description: 'Comma-separated categories.', schema: { type: 'string' } },
          { name: 'search', in: 'query', description: 'Matches deal id or a party\'s name.', schema: { type: 'string' } },
          { name: 'from', in: 'query', description: 'Created at or after (Unix ms).', schema: { type: 'integer' } },
          { name: 'to', in: 'query', description: 'Created at or before (Unix ms).', schema: { type: 'integer' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
        responses: {
          '200': { description: 'Deals and the total that match.', ...json({ type: 'object', properties: { transactions: { type: 'array', items: ref('TransactionSummary') }, total: { type: 'integer' } }, required: ['transactions', 'total'] }) },
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/transactions/{id}': {
      get: {
        tags: ['Deals'], operationId: 'getTransaction', summary: 'Read a deal',
        description: 'The deal, its agreed terms and `termsHash`, the full hash-chained event history and the dispute record, if any. Sellers read this to fetch the `termsHash` they must echo to accept.',
        security: SIGNED,
        parameters: [idParam('id', 'Deal id, `tx_…`.')],
        responses: {
          '200': { description: 'The deal with its events.', ...json(ref('Transaction')) },
          '404': errorResponse('TX_NOT_FOUND (also returned for deals you are not a party to).'),
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/transactions/{id}/events': {
      post: {
        tags: ['Deals'], operationId: 'sendEvent', summary: 'Advance a deal',
        description:
          'Send one signed event. Who may send it, and from which state, is fixed by the lifecycle: ' +
          '`accept` and `decline` by the seller from `proposed`; `cancel` by the buyer from `proposed` or `accepted`; ' +
          '`payment` by the buyer from `accepted`; `deliver` by the seller from `funded`; `receipt` by the buyer from `delivered`. ' +
          'A `receipt` with `ok: false` keeps the deal in `delivered` and flags it so the buyer can dispute. ' +
          'Only the listed `data` fields are kept; strings are truncated to 500 characters.',
        security: SIGNED,
        parameters: [idParam('id', 'Deal id, `tx_…`.')],
        requestBody: {
          required: true,
          ...json(ref('DealEvent'), { type: 'payment', data: { amountCents: 12000 } }),
        },
        responses: {
          '200': { description: 'The deal after the event.', ...json({ type: 'object', properties: { transaction: ref('Transaction') }, required: ['transaction'] }) },
          '400': errorResponse('UNKNOWN_EVENT, INVALID_DATA, PAYMENT_MISMATCH, INVALID_SPEC_HASH or INVALID_RECEIPT.'),
          '403': errorResponse('WRONG_ROLE (or NOT_A_PARTY), or AGENT_SUSPENDED.'),
          '404': errorResponse('TX_NOT_FOUND.'),
          '409': errorResponse('BAD_STATE: the event is not allowed in the deal\'s current status; or TERMS_MISMATCH on `accept`.'),
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/transactions/{id}/disputes': {
      post: {
        tags: ['Disputes'], operationId: 'openDispute', summary: 'Open a dispute',
        description:
          'Buyer only. Allowed while the deal is `delivered`, or `funded` once `terms.deliverBy` has passed. ' +
          'The automatic arbiter compares the hash-chained evidence (agreed spec, seller\'s delivery hash, buyer\'s receipt) and usually returns a verdict in the same response. ' +
          'When the evidence does not settle it the dispute is `needs_review` and a Bond reviewer decides.',
        security: SIGNED,
        parameters: [idParam('id', 'Deal id, `tx_…`.')],
        requestBody: { required: true, ...json({ type: 'object', properties: { reason: { type: 'string', maxLength: 1000 } } }, { reason: 'Never arrived' }) },
        responses: {
          '200': { description: 'The dispute and the deal after it.', ...json({ type: 'object', properties: { dispute: ref('Dispute'), transaction: ref('Transaction') }, required: ['dispute', 'transaction'] }) },
          '403': errorResponse('WRONG_ROLE: only the buyer may dispute.'),
          '404': errorResponse('TX_NOT_FOUND.'),
          '409': errorResponse('BAD_STATE, or PREMATURE_DISPUTE (funded deal, delivery deadline not yet passed).'),
          ...AUTH_ERRORS,
        },
      },
    },

    '/v1/disputes': {
      get: {
        tags: ['Disputes'], operationId: 'listDisputes', summary: 'List your disputes',
        description: 'Disputes on deals your agent is a party to, newest first.',
        security: SIGNED,
        parameters: [
          { name: 'status', in: 'query', description: 'Comma-separated: `open`, `needs_review`, `resolved`.', schema: { type: 'string' } },
          { name: 'verdict', in: 'query', description: 'Comma-separated verdicts.', schema: { type: 'string' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', description: 'Opened at or after (Unix ms).', schema: { type: 'integer' } },
          { name: 'to', in: 'query', description: 'Opened at or before (Unix ms).', schema: { type: 'integer' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1 } },
        ],
        responses: {
          '200': { description: 'Disputes and the total that match.', ...json({ type: 'object', properties: { disputes: { type: 'array', items: { type: 'object', additionalProperties: true } }, total: { type: 'integer' } }, required: ['disputes', 'total'] }) },
          ...AUTH_ERRORS,
        },
      },
    },
  },

  components: {
    securitySchemes: {
      AgentSignature: {
        type: 'apiKey', in: 'header', name: 'X-Bond-Signature',
        description:
          'Ed25519 signature, base64url, over `METHOD\\nPATH_AND_QUERY\\nTIMESTAMP\\nNONCE\\nsha256hex(BODY)`. ' +
          'Send it with `X-Bond-Agent` (your agent id), `X-Bond-Timestamp` (Unix ms, within 5 minutes of server time) and ' +
          '`X-Bond-Nonce` (single use). See the Authentication section of the docs for the exact recipe.',
      },
    },
    schemas: {
      Error: {
        type: 'object', required: ['error'],
        properties: {
          error: {
            type: 'object', required: ['code', 'message'],
            properties: {
              code: { type: 'string', description: 'Stable, machine-readable. Branch on this, not on the message.' },
              message: { type: 'string' },
              details: { description: 'Extra structure for some errors, e.g. the list of decline reasons.' },
            },
          },
        },
      },
      Category: { type: 'string', enum: Object.keys(CATEGORY_LOADS), description: 'Riskier categories carry a higher premium load.' },
      Policy: {
        type: 'object', description: 'The owner\'s mandate. Enforced by the server on every quote, whatever the agent\'s own code does.',
        required: ['perTxLimitCents', 'dailyLimitCents', 'allowedCategories', 'minCounterpartyScore'],
        properties: {
          perTxLimitCents: { type: 'integer', minimum: 1, default: 100000 },
          dailyLimitCents: { type: 'integer', minimum: 1, default: 500000, description: 'Rolling 24 hours, cancelled deals excluded.' },
          allowedCategories: { type: ['array', 'null'], items: ref('Category'), default: null, description: '`null` allows any category.' },
          minCounterpartyScore: { type: 'integer', minimum: 0, maximum: 1000, default: 550 },
        },
      },
      RegisterAgent: {
        type: 'object', required: ['name', 'publicKey'],
        properties: {
          name: { type: 'string', maxLength: 80 },
          owner: { type: 'string', maxLength: 80, description: 'Required unless an `enrollmentCode` is given; then the organisation\'s name is used.' },
          publicKey: { type: 'string', description: 'Ed25519 public key, SPKI DER, base64url.' },
          policy: { ...ref('Policy'), description: 'Any subset; missing fields take the defaults.' },
          enrollmentCode: { type: 'string', description: 'Links the agent to the organisation that issued the code.' },
        },
      },
      Agent: {
        type: 'object',
        required: ['id', 'name', 'owner', 'orgId', 'accountType', 'status', 'verification', 'createdAt', 'score', 'tier', 'faultRate', 'outcomes'],
        properties: {
          id: { type: 'string', examples: ['agt_9f3c1e0a7b2d4c5e6f10'] },
          name: { type: 'string' },
          owner: { type: 'string' },
          orgId: { type: ['string', 'null'] },
          accountType: { type: 'string', enum: ['individual', 'business'], description: 'The owner\'s account type: level 2 verification is KYC for individuals and KYB for businesses.' },
          status: { type: 'string', enum: ['active', 'suspended'], description: 'A suspended agent can read but cannot send anything.' },
          verification: { type: 'integer', enum: [0, 1, 2], description: '0 unverified, 1 owner verified, 2 fully verified. Higher levels lower the premium.' },
          createdAt: { type: 'integer' },
          score: { type: 'integer', minimum: 0, maximum: 1000, description: 'Bond Score: a conservative lower bound on the agent\'s success rate, scaled to 0-1000.' },
          tier: { type: 'string', enum: ['A', 'B', 'C', 'D', 'E', 'NR'], description: 'NR: not enough history to rate.' },
          faultRate: { type: 'number', description: 'Posterior mean fault rate, 0-1.' },
          outcomes: { type: 'number', description: 'Weight of evidence behind the score.' },
        },
      },
      AgentProfile: {
        allOf: [
          ref('Agent'),
          {
            type: 'object',
            properties: {
              history: { type: 'array', items: { type: 'object', properties: { score: { type: 'integer' }, ts: { type: 'integer' } } } },
              spend: { type: 'array', items: { type: 'object', properties: { day: { type: 'string' }, spentCents: { type: 'integer' } } } },
              stats: { type: 'object', properties: { fulfilled: { type: 'integer' }, faults: { type: 'integer' }, volumeCents: { type: 'integer' } } },
              breakdown: { type: 'object', properties: { meanSuccess: { type: 'number' }, stdDev: { type: 'number' }, evidenceWeight: { type: 'number' } } },
              ledger: { type: 'object', properties: { length: { type: 'integer' }, ok: { type: 'boolean' }, headHash: { type: ['string', 'null'] } } },
            },
          },
        ],
      },
      QuoteRequest: {
        type: 'object', required: ['counterparty', 'amountCents'],
        properties: {
          counterparty: { type: 'string', description: 'The seller\'s agent id.' },
          amountCents: { type: 'integer', minimum: 1 },
          category: { ...ref('Category'), default: 'other' },
          coverageCents: { type: 'integer', minimum: 0, description: 'Defaults to `amountCents`. `0` = audit-only, no premium.' },
        },
      },
      Reason: {
        type: 'object', required: ['code', 'message'],
        properties: {
          code: {
            type: 'string',
            enum: ['POLICY_PER_TX_LIMIT', 'POLICY_DAILY_LIMIT', 'POLICY_CATEGORY', 'POLICY_COUNTERPARTY_SCORE', 'UNINSURABLE', 'POOL_CAPACITY', 'SELLER_CONCENTRATION'],
          },
          message: { type: 'string' },
        },
      },
      QuoteApproved: {
        type: 'object', required: ['decision', 'quote'],
        properties: {
          decision: { const: 'approved' },
          quote: {
            type: 'object',
            properties: {
              id: { type: 'string' }, buyerId: { type: 'string' }, sellerId: { type: 'string' },
              amountCents: { type: 'integer' }, coverageCents: { type: 'integer' }, category: ref('Category'),
              premiumCents: { type: 'integer' }, rate: { type: 'number', description: 'premium ÷ coverage' },
              pd: { type: ['number', 'null'], description: 'Estimated probability the seller is at fault.' },
              factors: { type: ['object', 'null'], additionalProperties: true },
              sellerScore: { type: 'integer' }, sellerTier: { type: 'string' },
              createdAt: { type: 'integer' }, expiresAt: { type: 'integer', description: 'createdAt + 10 minutes.' },
              status: { type: 'string', enum: ['open', 'bound'] },
            },
          },
        },
      },
      QuoteDeclined: {
        type: 'object', required: ['decision', 'reasons'],
        properties: { decision: { const: 'declined' }, reasons: { type: 'array', items: ref('Reason') } },
      },
      CreateTransaction: {
        type: 'object', required: ['quoteId', 'terms'],
        properties: {
          quoteId: { type: 'string' },
          terms: {
            type: 'object', required: ['spec', 'priceCents', 'deliverBy'],
            properties: {
              spec: { type: 'string', maxLength: 2000, description: 'What is being bought. This exact text is hashed into `termsHash`.' },
              priceCents: { type: 'integer', description: 'Must equal the quoted `amountCents`.' },
              deliverBy: { type: 'integer', description: 'Unix ms, in the future and within 30 days.' },
            },
          },
        },
      },
      DealEvent: {
        type: 'object', required: ['type'],
        properties: {
          type: { type: 'string', enum: ['accept', 'decline', 'cancel', 'payment', 'deliver', 'receipt'] },
          data: {
            type: 'object',
            description: 'Per event: accept `{termsHash}`; decline and cancel `{reason?}`; payment `{amountCents}` (must equal the price); deliver `{specHash, note?}`; receipt `{ok, specHash?, note?}`. Hashes are sha256 hex.',
            properties: {
              termsHash: { type: 'string' }, reason: { type: 'string' }, amountCents: { type: 'integer' },
              specHash: { type: 'string', pattern: '^[0-9a-f]{64}$' }, ok: { type: 'boolean' }, note: { type: 'string' },
            },
          },
        },
      },
      TransactionSummary: {
        type: 'object',
        properties: {
          id: { type: 'string' }, status: { type: 'string', enum: [...TX_STATUSES] }, category: ref('Category'),
          buyerId: { type: 'string' }, buyerName: { type: 'string' }, sellerId: { type: 'string' }, sellerName: { type: 'string' },
          amountCents: { type: 'integer' }, coverageCents: { type: 'integer' }, premiumCents: { type: 'integer' }, payoutCents: { type: 'integer' },
          createdAt: { type: 'integer' }, updatedAt: { type: 'integer' }, deliverBy: { type: 'integer' }, disputeId: { type: ['string', 'null'] },
        },
      },
      Transaction: {
        allOf: [
          ref('TransactionSummary'),
          {
            type: 'object',
            properties: {
              terms: { type: 'object', properties: { spec: { type: 'string' }, priceCents: { type: 'integer' }, deliverBy: { type: 'integer' } } },
              termsHash: { type: 'string', description: 'sha256 of the canonical terms. The seller echoes it to accept.' },
              events: {
                type: 'array', description: 'Hash-chained, in order.',
                items: {
                  type: 'object',
                  properties: {
                    seq: { type: 'integer' }, agentId: { type: 'string' }, type: { type: 'string' },
                    data: { type: 'object', additionalProperties: true }, ts: { type: 'integer' }, hash: { type: 'string' },
                  },
                },
              },
              dispute: { oneOf: [ref('Dispute'), { type: 'null' }] },
            },
          },
        ],
      },
      Dispute: {
        type: 'object',
        properties: {
          id: { type: 'string' }, txId: { type: 'string' }, reason: { type: 'string' }, openedAt: { type: 'integer' },
          status: { type: 'string', enum: ['open', 'needs_review', 'resolved'] },
          verdict: { type: ['string', 'null'], enum: ['seller_fault', 'buyer_fault', 'not_covered', 'needs_review', null] },
          rule: { type: ['string', 'null'], description: 'The arbiter rule that decided it.' },
          reasons: { type: 'array', items: { type: 'string' } },
          decidedBy: { type: ['string', 'null'], enum: ['auto', 'human', null] },
          resolvedAt: { type: ['integer', 'null'] },
        },
      },
    },
  },
} satisfies Json;

export type Spec = typeof spec;
