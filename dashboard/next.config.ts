import type { NextConfig } from 'next';

// Where the Bond API lives. The browser never talks to it directly: it calls /v1/* on the dashboard's own origin
// and Next forwards those requests here. That keeps the session cookie first-party (SameSite=Strict just works)
// and means the API needs no CORS.
const API_URL = (process.env.BOND_API_URL || 'http://localhost:4100').replace(/\/$/, '');

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@bond/console-core'],
  // The old Verification and Team pages now live inside Organization.
  async redirects() {
    return [
      { source: '/verification', destination: '/organization#verification', permanent: true },
      { source: '/team', destination: '/organization#team', permanent: true },
    ];
  },
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
