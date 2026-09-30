// The address agents send requests to, as the docs show it. Set VITE_BOND_API_URL when building (the deploy does, from
// the running API service); without it the docs say "local development" and that preview hosts are shared on onboarding.
//
// Read in two places: the browser/SSR build (Vite puts VITE_* on import.meta.env) and the Node process that loads
// vite.config.ts to publish /openapi.json (there it is an ordinary environment variable).

/** A usable base URL, or undefined. Only http(s) addresses count; a trailing slash is dropped. */
export function cleanApiBaseUrl(value: string | undefined): string | undefined {
  const v = (value ?? '').trim();
  return /^https?:\/\/[^\s/]+/i.test(v) ? v.replace(/\/+$/, '') : undefined;
}

export const API_BASE_URL: string | undefined = cleanApiBaseUrl(
  import.meta.env?.VITE_BOND_API_URL ?? (typeof process !== 'undefined' ? process.env?.VITE_BOND_API_URL : undefined),
);

export const LOCAL_API_URL = 'http://localhost:4100';
