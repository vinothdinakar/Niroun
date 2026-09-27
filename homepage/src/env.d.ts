/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Full URL that accepts waitlist signups (POST JSON). Unset = preview mode: nothing is sent. */
  readonly VITE_WAITLIST_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
