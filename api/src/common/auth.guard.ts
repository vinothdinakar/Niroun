import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClockService } from '../core/clock.service';
import { NonceService } from '../core/nonce.service';
import { MongoService } from '../storage/mongo.service';
import { SessionsService } from '../identity/sessions.service';
import { agentIdFromKey, signingString, verifySignature } from '../domain/agent-auth';
import { sha256 } from '../domain/canonical';
import { Permission, can } from '../domain/roles';
import { ACCESS_KEY, AccessMode, PERMISSION_KEY } from './decorators';
import { HttpError, forbidden } from './http-error';
import { appHint, parseCookies, sessionCookieName } from './cookies';
import { BondRequest, Principal } from './request';

const FRESH_MS = 5 * 60 * 1000;
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// The one place that decides who is calling. Registered globally, so every route is covered.
// Agents prove themselves with a signed request; people with a session cookie. The result lands on
// `req.principal`, where the @CurrentUser() / @AgentId() / @CallerScope() decorators read it.
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly clock: ClockService,
    private readonly mongo: MongoService,
    private readonly sessions: SessionsService,
    private readonly nonces: NonceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<BondRequest>();
    const mode = this.reflector.getAllAndOverride<AccessMode | undefined>(ACCESS_KEY, [context.getHandler(), context.getClass()]) ?? 'user';
    const principal: Principal = {};
    req.principal = principal;

    if (mode === 'agent' || mode === 'register') Object.assign(principal, await this.authenticateAgent(req, mode));
    else if (mode === 'user') Object.assign(principal, await this.authenticateUser(req));
    else if (mode === 'any') {
      if (req.headers['x-bond-signature']) Object.assign(principal, await this.authenticateAgent(req, 'agent'));
      else Object.assign(principal, await this.authenticateUser(req));
    }

    const perm = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (perm && (!principal.user || !can(principal.user, perm))) throw forbidden();
    return true;
  }

  private async authenticateAgent(req: BondRequest, mode: 'agent' | 'register'): Promise<Principal> {
    const h = req.headers;
    const id = h['x-bond-agent'] as string | undefined;
    const ts = Number(h['x-bond-timestamp']);
    const nonce = h['x-bond-nonce'] as string | undefined;
    const sig = h['x-bond-signature'] as string | undefined;
    const fail = (code: string, msg: string) => new HttpError(401, code, msg);
    if (!id || !ts || !nonce || !sig) throw fail('AUTH_MISSING', 'Missing X-Bond-Agent / -Timestamp / -Nonce / -Signature headers');
    const now = this.clock.now();
    if (Math.abs(now - ts) > FRESH_MS) throw fail('AUTH_STALE', 'Request timestamp is outside the 5 minute window');

    let publicKey: string;
    let status: string | undefined;
    if (mode === 'register') {
      const claimed = (req.body as { publicKey?: unknown } | undefined)?.publicKey;
      if (typeof claimed !== 'string' || agentIdFromKey(claimed) !== id) throw fail('AUTH_ID_MISMATCH', 'Agent id must be derived from the supplied public key');
      publicKey = claimed;
    } else {
      const agent = await this.mongo.agents.get(id);
      if (!agent) throw fail('AUTH_UNKNOWN_AGENT', 'Unknown agent');
      publicKey = agent.publicKey;
      status = agent.status;
    }
    const raw = req.rawBody ?? '';
    const msg = signingString({ method: req.method, path: req.originalUrl, timestamp: ts, nonce, body: raw });
    if (!verifySignature(publicKey, msg, sig)) throw fail('AUTH_BAD_SIGNATURE', 'Signature verification failed');
    if (!(await this.nonces.use(`${id}:${nonce}`))) throw fail('AUTH_REPLAY', 'Nonce already used');
    // Owner kill switch: a suspended agent can read, but can't send anything.
    if (mode !== 'register' && status === 'suspended' && req.method !== 'GET') {
      throw new HttpError(403, 'AGENT_SUSPENDED', 'This agent has been suspended by its owner');
    }
    return { agentId: id, proof: { reqHash: sha256(raw) } };
  }

  private async authenticateUser(req: BondRequest): Promise<Principal> {
    const name = sessionCookieName(appHint(req.headers['x-bond-app'] as string | undefined));
    const token = parseCookies(req.headers.cookie)[name];
    const user = await this.sessions.userFor(token);
    if (!user) throw new HttpError(401, 'AUTH_REQUIRED', 'Sign in required');
    // Cookie-authenticated writes must be JSON: a cross-site HTML form can't send that.
    if (UNSAFE.has(req.method) && !/^application\/json\b/i.test(req.headers['content-type'] || '')) {
      throw new HttpError(415, 'JSON_REQUIRED', 'Content-Type must be application/json');
    }
    return { user, sessionToken: token };
  }
}
