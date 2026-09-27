import { Injectable } from '@nestjs/common';
import { Document, Filter } from 'mongodb';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from '../core/clock.service';
import { LedgerService } from '../core/ledger.service';
import { HttpError, badRequest } from '../common/http-error';
import { Scope } from '../common/scope';
import { Agent, AgentStatus, Outcome, Tx, User, Verification } from '../storage/db.types';
import { agentIdFromKey } from '../domain/agent-auth';
import { DEFAULT_POLICY, validatePolicy } from '../domain/policy';
import { PAIR_CAP, ScoreResult, computeScore, outcomeWeight, scoreHistory } from '../domain/scoring';
import { AgentDetail, AgentProfile, AgentWithPolicy, PublicAgent, RegisterAgentInput } from './agents.types';

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

// Agents: registration, identity, the owner's mandate, the kill switch, and reputation (the Bond Score).
// Reputation is computed from each agent's recorded outcomes (one document per outcome) every time it is read,
// so it can never disagree with the underlying history.
@Injectable()
export class AgentsService {
  constructor(
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly ledger: LedgerService,
  ) {}

  private get outcomes() {
    return this.mongo.col('outcomes');
  }

  // ---------- lookups ----------
  async orThrow(id: string): Promise<Agent> {
    const a = await this.mongo.agents.get(id);
    if (!a) throw new HttpError(404, 'AGENT_NOT_FOUND', `Unknown agent ${id}`);
    return a;
  }

  ofOrg(orgId: string): Promise<Agent[]> {
    return this.mongo.agents.find({ orgId });
  }

  // ---------- who may see what ----------
  async inScope(scope: Scope, agentId: string): Promise<boolean> {
    if (scope.all) return true;
    if (scope.agentId) return scope.agentId === agentId;
    if (scope.orgId) return (await this.mongo.agents.get(agentId))?.orgId === scope.orgId;
    return false;
  }

  async txInScope(scope: Scope, tx: Pick<Tx, 'buyerId' | 'sellerId'>): Promise<boolean> {
    return (await this.inScope(scope, tx.buyerId)) || (await this.inScope(scope, tx.sellerId));
  }

  /** The ids of every agent the scope can see, or null for "all of them". */
  async scopedAgentIds(scope: Scope): Promise<string[] | null> {
    if (scope.all) return null;
    if (scope.agentId) return [scope.agentId];
    if (scope.orgId) return (await this.ofOrg(scope.orgId)).map((a) => a.id);
    return [];
  }

  /** A query filter selecting the deals this scope may see (a deal is visible if either party is). */
  async txFilter(scope: Scope): Promise<Filter<Document>> {
    const ids = await this.scopedAgentIds(scope);
    return ids === null ? {} : { $or: [{ buyerId: { $in: ids } }, { sellerId: { $in: ids } }] };
  }

  /** 404 (not 403) for agents outside the caller's scope, so their existence doesn't leak. */
  async assertVisible(scope: Scope, agentId: string): Promise<void> {
    if (!(await this.inScope(scope, agentId))) throw new HttpError(404, 'AGENT_NOT_FOUND', `Unknown agent ${agentId}`);
  }

  // ---------- reputation ----------
  private strip(doc: Document): Outcome {
    const { _id, agentId, ...outcome } = doc;
    return outcome as unknown as Outcome;
  }

  async outcomesOf(id: string): Promise<Outcome[]> {
    const docs = await this.outcomes.find({ agentId: id }, { sort: { _id: 1 }, ...this.mongo.tx }).toArray();
    return docs.map((d) => this.strip(d));
  }

  async scoreOf(agent: Agent, at = this.clock.now(), outcomes?: Outcome[]): Promise<ScoreResult> {
    return computeScore(agent, outcomes ?? (await this.outcomesOf(agent.id)), at);
  }

  /** Record how a deal turned out for `agentId`. A counterparty can vouch for you only up to PAIR_CAP in total. */
  async recordOutcome(agentId: string, kind: 'fulfilled' | 'fault', tx: Tx, counterpartyId: string): Promise<void> {
    let weight = outcomeWeight(tx.terms.priceCents);
    if (kind === 'fulfilled') {
      const [row] = await this.outcomes
        .aggregate([{ $match: { agentId, cp: counterpartyId, kind: 'fulfilled' } }, { $group: { _id: null, sum: { $sum: '$weight' } } }], this.mongo.tx)
        .toArray();
      weight = Math.max(0, Math.min(weight, PAIR_CAP - ((row?.sum as number | undefined) ?? 0)));
    }
    await this.outcomes.insertOne(
      { agentId, ts: this.clock.now(), kind, weight, amountCents: tx.terms.priceCents, txId: tx.id, cp: counterpartyId },
      this.mongo.tx,
    );
  }

  async publicAgent(a: Agent, outcomes?: Outcome[]): Promise<PublicAgent> {
    const s = await this.scoreOf(a, undefined, outcomes);
    return {
      id: a.id, name: a.name, owner: a.owner, orgId: a.orgId ?? null, status: a.status ?? 'active',
      verification: a.verification, createdAt: a.createdAt,
      score: s.score, tier: s.tier, faultRate: round4(1 - s.mean), outcomes: s.outcomes,
    };
  }

  // ---------- registration ----------
  register(input: RegisterAgentInput, proof: { reqHash?: string } | null): Promise<PublicAgent> {
    const str = (v: unknown, f: string): string => {
      if (typeof v !== 'string' || !v.trim() || v.length > 80) throw badRequest('INVALID_FIELD', `${f} must be a non-empty string (max 80 chars)`);
      return v.trim();
    };
    const name = str(input.name, 'name');
    // A linked agent's owner is the organisation that enrolled it, never a self-declared string.
    const owner = input.orgName ?? str(input.owner, 'owner');
    const id = agentIdFromKey(input.publicKey);
    const { errors, policy } = validatePolicy({ ...DEFAULT_POLICY, ...(input.policy || {}) });
    if (errors.length) throw badRequest('INVALID_POLICY', errors.join('; '));

    return this.mongo.transaction(async () => {
      if (await this.mongo.agents.get(id)) throw new HttpError(409, 'AGENT_EXISTS', 'An agent with this key is already registered');
      const orgId = input.orgId ?? null;
      // An agent enrolled by a verified organisation starts out verified (cheaper bonds); unlinked agents start at 0.
      const agent: Agent = {
        id, name, owner, orgId, status: 'active', publicKey: input.publicKey, policy,
        verification: orgId ? (input.orgVerification ?? 0) : 0, createdAt: this.clock.now(),
      };
      await this.mongo.agents.insert(agent);
      await this.ledger.log(id, 'registered', { name, owner, policy }, null, proof);
      return this.publicAgent(agent, []);
    });
  }

  async me(agentId: string): Promise<AgentWithPolicy> {
    const a = await this.orThrow(agentId);
    return { ...(await this.publicAgent(a)), policy: a.policy };
  }

  // ---------- the owner's mandate ----------
  /**
   * An agent may set its own mandate only while it is unlinked. Once an organisation owns it,
   * the mandate is the owner's control and a (possibly compromised) agent can't loosen it.
   */
  updateOwnPolicy(agentId: string, patch: Record<string, unknown> | undefined, proof: { reqHash?: string } | null): Promise<AgentWithPolicy> {
    return this.mongo.transaction(async () => {
      const a = await this.orThrow(agentId);
      if (a.orgId) throw new HttpError(403, 'POLICY_LOCKED', "This agent's mandate is managed by its owner organisation");
      const { errors, policy } = validatePolicy({ ...a.policy, ...(patch || {}) });
      if (errors.length) throw badRequest('INVALID_POLICY', errors.join('; '));
      a.policy = policy;
      await this.mongo.agents.save(a);
      await this.ledger.log(agentId, 'policy_updated', { policy }, null, proof);
      return this.me(agentId);
    });
  }

  /** Owner/staff path. Recorded in the agent's audit ledger with who made the change. */
  setPolicyByOwner(agentId: string, patch: Record<string, unknown> | undefined, actor: Pick<User, 'email'>): Promise<AgentWithPolicy> {
    return this.mongo.transaction(async () => {
      const a = await this.orThrow(agentId);
      const { errors, policy } = validatePolicy({ ...a.policy, ...(patch || {}) });
      if (errors.length) throw badRequest('INVALID_POLICY', errors.join('; '));
      a.policy = policy;
      await this.mongo.agents.save(a);
      await this.ledger.log(agentId, 'policy_updated', { policy, by: actor.email });
      return { ...(await this.publicAgent(a)), policy };
    });
  }

  /** Kill switch: a suspended agent can still be read but can't send anything. */
  setStatus(agentId: string, status: unknown, actor: Pick<User, 'email'>): Promise<PublicAgent> {
    return this.mongo.transaction(async () => {
      const a = await this.orThrow(agentId);
      if (status !== 'active' && status !== 'suspended') throw badRequest('INVALID_STATUS', 'status must be active or suspended');
      a.status = status as AgentStatus;
      await this.mongo.agents.save(a);
      await this.ledger.log(agentId, 'status_changed', { status, by: actor.email });
      return this.publicAgent(a);
    });
  }

  setVerification(agentId: string, level: unknown): Promise<PublicAgent> {
    return this.mongo.transaction(async () => {
      const a = await this.orThrow(agentId);
      if (level !== 0 && level !== 1 && level !== 2) throw badRequest('INVALID_LEVEL', 'level must be 0, 1 or 2');
      a.verification = level as Verification;
      await this.mongo.agents.save(a);
      await this.ledger.log(agentId, 'verification_set', { level });
      return this.publicAgent(a);
    });
  }

  // ---------- read models ----------
  async profile(id: string): Promise<AgentProfile> {
    const a = await this.orThrow(id);
    const outs = await this.outcomesOf(id);
    const s = await this.scoreOf(a, undefined, outs);
    const v = await this.ledger.verify(id);
    return {
      ...(await this.publicAgent(a, outs)),
      history: scoreHistory(a, outs, a.createdAt),
      stats: {
        fulfilled: outs.filter((o) => o.kind === 'fulfilled').length,
        faults: outs.filter((o) => o.kind === 'fault').length,
        volumeCents: outs.reduce((sum, o) => sum + o.amountCents, 0),
      },
      breakdown: { meanSuccess: round4(s.mean), stdDev: round4(s.sd), evidenceWeight: round4(s.a + s.b - 10) },
      ledger: { length: v.length, ok: v.ok, headHash: v.headHash },
    };
  }

  async detail(id: string): Promise<AgentDetail> {
    const a = await this.orThrow(id);
    return { ...(await this.profile(id)), policy: a.policy };
  }

  /** Every agent with its reputation, best score first. One query for agents and one for all outcomes. */
  async list(): Promise<PublicAgent[]> {
    const [agents, docs] = await Promise.all([
      this.mongo.agents.find(),
      this.outcomes.find({}, { sort: { _id: 1 }, ...this.mongo.tx }).toArray(),
    ]);
    const byAgent = new Map<string, Outcome[]>();
    for (const d of docs) {
      const list = byAgent.get(d.agentId as string) ?? [];
      list.push(this.strip(d));
      byAgent.set(d.agentId as string, list);
    }
    const out = await Promise.all(agents.map((a) => this.publicAgent(a, byAgent.get(a.id) ?? [])));
    return out.sort((x, y) => y.score - x.score);
  }
}
