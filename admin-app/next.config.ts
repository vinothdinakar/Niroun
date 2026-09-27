import type { NextConfig } from 'next';

// Where the Bond API lives. The browser never talks to it directly: it calls /v1/* on this app's own origin
// and Next forwards those requests here. Same API as the customer dashboard, different front door: this app
// gets its own origin and its own session cookie, so a bug in the customer-facing app can never reach a staff
// session, and this app can be put behind a VPN/allowlist without touching the customer dashboard at all.
const API_URL = (process.env.BOND_API_URL || 'http://localhost:4100').replace(/\/$/, '');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@bond/console-core'],
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${API_URL}/v1/:path*` }];
  },
  // The Content-Security-Policy is set per request (with a nonce) in src/middleware.ts; these are the static ones.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
