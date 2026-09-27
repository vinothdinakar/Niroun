# Bond: business plan (deeper cut)

## 1. Thesis

Agent-to-agent commerce breaks the assumptions human commerce runs on. Humans have identity documents, credit
histories, reputations they can lose, and courts. A software agent that can be spun up in a second has none of these.
Two things must exist before enterprises let agents spend real money with strangers:

1. **A way to price counterparty risk** (who is this agent, and how often does it honour deals?).
2. **A way to make the loser whole** (bonding, and fast, evidence-based dispute resolution).

Whoever accumulates the largest history of *agent behaviour with money attached* can price risk better than anyone.
That dataset is the company. Everything else (SDK, dashboard, API) is a way to collect it.

## 2. Product, in the order it ships

| Layer | What it is | Why it comes first / last |
|---|---|---|
| **Guardrail SDK** (free) | Agent identity, signed audit log, owner-set spending mandate | Solves a pain that exists *today* (CFOs won't let agents hold a card without limits and logs). Zero insurance risk. Collects the data. |
| **Bond Score API** (paid per lookup) | Reputation of any agent, from ledger outcomes | High margin, no capital needed. Marketplaces and agent frameworks call it before trading. |
| **Bonded transactions** (premium) | Live-priced coverage on a deal, automated claims | The capital-intensive, regulated layer. Comes only once loss data justifies pricing. |
| **Arbitration-as-a-service** | The arbiter as an API for platforms that want dispute resolution without coverage | Sells the evidence format (signed, hash-chained deliveries) as a standard. |

The MVP in this repo implements all four end to end, so the loops can be demonstrated, but a real launch turns them on in that order.

## 3. Who buys

- **Now (2026):** teams shipping purchasing / procurement / travel / ad-buying agents. Buyer: engineering + finance. Trigger: "we can't give this agent a budget without limits, logs, and someone to blame".
- **Next:** agent marketplaces and tool directories that need a trust signal for listings. Buyer: platform product teams. Channel: they embed Bond Score and bonded checkout.
- **Later:** insurers and reinsurers who want agent-commerce exposure priced with real data, and regulators / auditors who need the ledger. Bond becomes the underwriting data layer.

## 4. Economics: an honest look

Worked example at a scale that might exist in a couple of years: **$100M of bonded GMV/year**, 2% blended premium.

| | |
|---|---|
| Premium revenue | $2.0M |
| Claims at a 65% loss ratio | ($1.3M) |
| Underwriting margin, before opex and fronting fees | ~$0.7M |

Thin. **Premium income alone is a low-margin insurance business.** What changes that:

- **Loss ratio is the whole game.** Each 10 points of loss ratio is $200k here. Better data means fewer bad risks written and better prices on good ones. The simulation reads 76% because it is adversarial by design (scammers, false claimers, wash traders) and new agents cost money while Bond learns them. Real target: below 55% at maturity.
- **Non-premium revenue is where the margin is.** Score API lookups, SDK/enterprise seats, and arbitration fees carry no claims risk. Aim for these to be more than half of gross profit.
- **Float and capital efficiency.** Reserve leverage (4x in the MVP) and reinsurance for tail risk determine return on capital.
- **Take-rate discipline.** In the simulation premiums run ~12% of volume because it is a hostile market; a healthy marketplace should see 1-3%. If real-world premiums need to be much higher to stay solvent, the product doesn't work, and this is the first number to learn.

## 5. Regulatory reality (do not skip)

Paying out when a counterparty fails is **insurance or suretyship** in most jurisdictions. The MVP uses fictional capital. To take real money:

- **Route A: MGA + fronting carrier.** Bond acts as managing general agent: underwrites and administers claims on a licensed carrier's paper, with reinsurance behind it. Standard route for a new insurance product; fronting costs a fee and demands loss-data transparency.
- **Route B: escrow / service-contract structure** where the local law allows a non-insurance guarantee. Cheaper, narrower, and jurisdiction-specific.
- **Route C: surety bonds** issued by a licensed surety, with agents/owners posting collateral.
- Payments touch money-transmission rules; use a licensed payments partner rather than holding funds.
- Talk to an insurance-regulatory lawyer **before** writing the first policy. This is a founder task for month 1, not month 12.

## 6. Risks and what the MVP does about them

| Risk | Mitigation in the MVP | Still open |
|---|---|---|
| **Adverse selection**: risky agents are the ones seeking cover | Price on posterior fault rate; decline above 35%; owner verification discounts | Needs real loss data; add seller-side deposits |
| **Sybil / wash trading** | Per-counterparty credit cap, value-weighting, premiums cost real money | Graph analysis (collusion clusters), stake-weighted identity |
| **Oracle problem**: proving delivery actually happened | Hash-attestation by both parties; conflicts go to humans | Physical goods and subjective quality need third-party attestations (carriers, IoT, validators) |
| **Cold start** | Prior + verification bonus + audit-only free tier | Seeding with attested history from partner platforms |
| **Concentration / ruin** | Reserve ratio, per-seller cap | Portfolio-level correlation limits, reinsurance |
| **Ledger trust**: Bond hosts the chain | Hash chain makes tampering detectable | Periodic public anchoring (Merkle root) and third-party verifiers |
| **Privacy**: deal contents in the ledger | Only hashes are needed for arbitration | Commitments-only mode; encrypted terms |
| **Platform risk**: payment networks and agent-protocol vendors ship their own identity/trust | Bond's asset is loss history and capital, not identity | Integrate with those protocols rather than compete with them |
| **Model risk**: my priors and loadings are assumptions | Parameters are in one place each (`scoring.js`, `pricing.js`) | Backtest and recalibrate on real outcomes; independent actuarial review |

## 7. Roadmap

**First 30 days:** legal consult on the licensing route; 5 design-partner teams running purchasing agents; ship the guardrail SDK as audit-only; define the delivery-attestation schema with them.

**Days 30-90:** wire a real payments partner (test mode); replace JSON storage with Postgres; add an LLM-assisted arbiter *behind* the deterministic rules (rules stay as the audit baseline, LLM handles `needs_review` triage); backtest scoring on the partners' real outcomes.

**Months 3-12:** Bond Score API GA with two marketplaces integrated; first bonded transactions on a fronted carrier's paper with a hard cap on total exposure; public Merkle anchoring; collusion-graph detection; expansion of attestation sources for physical goods.

**Kill / pivot signals:** design partners won't route real spend through guardrails (no demand); measured fault rates are so low that premiums can't cover fronting + ops (pivot to Score API + arbitration only); or so high that no price works (the market isn't ready).

## 8. What the MVP proves, and what it doesn't

**Proves:** the mechanism is coherent. A signed ledger gives the arbiter enough evidence to settle the clear cases automatically; reputation separates honest, sloppy, and malicious agents; simple defences blunt wash trading and false claims; pricing responds to risk; the pool can enforce capacity limits.

**Doesn't prove:** that real agents fail at rates that make bonding viable, that customers will pay for it, or that the priors are right. Those need design partners and real data, and that is the next step.
