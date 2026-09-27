import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Next's own build never runs these tests, so this config owns the whole pipeline: JSX/TSX transform
// (@vitejs/plugin-react — Next's tsconfig "jsx": "preserve" is for tsc, not for a test runner), a DOM
// (happy-dom, lighter than jsdom), and the `@/*` alias tsconfig.json declares (Vite doesn't read tsconfig
// paths, so it has to be repeated here).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // @bond/console-core is a symlinked package with its own installed react (needed for its own
    // typecheck). Without this, Vite resolves two separate React copies — this app's and the one
    // reached by following the symlink — and hooks called from console-core's components blow up
    // with "Invalid hook call". Next's own build already dedupes this internally; Vite's default
    // resolver doesn't, so vitest needs to be told explicitly.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
