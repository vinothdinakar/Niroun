import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { BondRequest } from './request';
import { Scope } from './scope';
import { Permission, isStaff } from '../domain/roles';

/**
 * How a route authenticates. Routes with no @Access() default to 'user' (console session), so forgetting
 * to annotate a route fails closed, not open.
 *
 *   public    nobody (sign-in, signup, health)
 *   agent     a signed request from a registered agent
 *   register  a signed request from a NEW agent (proves it holds the private key it is registering)
 *   user      a signed-in person (session cookie)
 *   any       either of the above
 */
export type AccessMode = 'public' | 'agent' | 'register' | 'user' | 'any';

export const ACCESS_KEY = 'bond:access';
export const PERMISSION_KEY = 'bond:permission';

export const Access = (mode: AccessMode) => SetMetadata(ACCESS_KEY, mode);
/** The signed-in person must hold this permission (checked by AuthGuard, before the handler runs). */
export const RequirePermission = (perm: Permission) => SetMetadata(PERMISSION_KEY, perm);

const req = (ctx: ExecutionContext) => ctx.switchToHttp().getRequest<BondRequest>();

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => req(ctx).principal?.user);
export const SessionToken = createParamDecorator((_: unknown, ctx: ExecutionContext) => req(ctx).principal?.sessionToken);
export const AgentId = createParamDecorator((_: unknown, ctx: ExecutionContext) => req(ctx).principal?.agentId);
export const Proof = createParamDecorator((_: unknown, ctx: ExecutionContext) => req(ctx).principal?.proof ?? null);
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext) => req(ctx).clientIp ?? 'unknown');

/** What the caller may see: staff everything, a customer their company, an agent itself. */
export const CallerScope = createParamDecorator((_: unknown, ctx: ExecutionContext): Scope => {
  const p = req(ctx).principal;
  if (p?.user) return isStaff(p.user) ? { all: true } : { orgId: p.user.orgId ?? undefined };
  return { agentId: p?.agentId };
});
