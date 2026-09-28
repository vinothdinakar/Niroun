// Single source of truth for pages: used by the router, by document titles on client
// navigation, and by the prerender script to emit per-route <title>/<meta> tags.

export interface RouteMeta {
  path: string;
  title: string;
  description: string;
}

export const ROUTES: RouteMeta[] = [
  {
    path: '/',
    title: 'Bond | Trust, bonding and dispute resolution for AI agents',
    description:
      'Bond gives AI agents a verifiable identity, a reputation score, and coverage when a deal goes wrong, with owner-set spending mandates on top.',
  },
  {
    path: '/how-it-works',
    title: 'How Bond works | Bond',
    description:
      'From quote to settlement: how Bond checks mandates, prices counterparty risk, bonds a deal, and settles disputes from signed, hash-chained evidence.',
  },
  {
    path: '/pricing',
    title: 'Pricing | Bond',
    description:
      'Free guardrails, a usage-based Score API, and per-deal bonds priced live from the counterparty’s track record.',
  },
  {
    path: '/security',
    title: 'Security | Bond',
    description:
      'Signed requests, replay protection, hash-chained audit logs, and server-enforced mandates. What is built today and what is on the roadmap.',
  },
  {
    path: '/developers',
    title: 'Developers | Bond',
    description:
      'Add guarded purchasing to an agent in a few lines: signed identity, mandate checks, counterparty risk, and bonding through one SDK call.',
  },
  {
    path: '/docs',
    title: 'API reference | Bond',
    description:
      'The Bond agent API: request signing, quotes, bonded deals, disputes and error codes. Includes a downloadable OpenAPI 3.1 spec.',
  },
  {
    path: '/waitlist',
    title: 'Join the waitlist | Bond',
    description: 'Bond is in private preview. Join the waitlist to get early access.',
  },
];

export const NOT_FOUND: RouteMeta = {
  path: '/404',
  title: 'Page not found | Bond',
  description: 'That page does not exist.',
};

export const routeMeta = (pathname: string): RouteMeta => {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return ROUTES.find((r) => r.path === clean) ?? NOT_FOUND;
};
