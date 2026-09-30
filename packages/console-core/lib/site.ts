// Addresses the console shows people. Both are fixed when the app is built (Next inlines NEXT_PUBLIC_* values), and read
// here at call time so a test can change them.

/** The API agents send their requests to: what the dashboard was built to forward /v1/* to. Empty when unknown. */
export const apiBaseUrl = (): string => (process.env.NEXT_PUBLIC_BOND_API_URL ?? '').replace(/\/+$/, '');

/** The public API reference (the homepage's /docs). Empty when it isn't set up. */
export const docsUrl = (): string => process.env.NEXT_PUBLIC_DOCS_URL ?? '';
