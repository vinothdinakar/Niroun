/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full URL that accepts waitlist signups (POST JSON). Unset = preview mode: nothing is sent. */
  readonly VITE_WAITLIST_ENDPOINT?: string;
  /** The API address the docs show as the base URL (https://...). Unset = the docs say local development. */
  readonly VITE_BOND_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
