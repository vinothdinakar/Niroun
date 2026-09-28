import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { spec } from './src/docs/spec';

const openapi = JSON.stringify(spec, null, 2) + '\n';

// Publishes the spec the /docs page renders from as /openapi.json (dev server and client build).
const openapiJson = (): Plugin => {
  let ssr = false;
  return {
    name: 'bond-openapi',
    configResolved(c) { ssr = !!c.build.ssr; },
    configureServer(server) {
      server.middlewares.use('/openapi.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(openapi);
      });
    },
    generateBundle() {
      if (!ssr) this.emitFile({ type: 'asset', fileName: 'openapi.json', source: openapi });
    },
  };
};

export default defineConfig({
  plugins: [react(), openapiJson()],
  server: { port: 5173 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
