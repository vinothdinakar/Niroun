import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fieldsOf, operations, resolveRef } from './schema';
import { CATEGORY_LOADS, spec } from './spec';

const ops = operations();

// Every route the API registers under /v1, read from the controllers' decorators.
function apiRoutes(): Set<string> {
  const root = resolve(__dirname, '../../../api/src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.controller.ts')) files.push(p);
    }
  };
  walk(root);
  const routes = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const base = /@Controller\('([^']*)'\)/.exec(src)?.[1] ?? '';
    for (const m of src.matchAll(/@(Get|Post|Put|Delete)\('([^']*)'\)/g)) {
      const path = '/' + [base, m[2]].filter(Boolean).join('/');
      routes.add(`${m[1].toUpperCase()} ${path}`);
    }
  }
  return routes;
}

describe('OpenAPI spec', () => {
  it('is OpenAPI 3.1 and gives every operation a unique id, a tag and a summary', () => {
    expect(spec.openapi).toBe('3.1.0');
    const ids = ops.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
    const tags = new Set(spec.tags.map((t) => t.name));
    for (const o of ops) {
      expect(tags.has(o.tag), `${o.id} uses unknown tag ${o.tag}`).toBe(true);
      expect(o.summary.length).toBeGreaterThan(3);
      expect(o.responses.length).toBeGreaterThan(0);
    }
  });

  it('resolves every $ref', () => {
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) expect(() => resolveRef(r), r).not.toThrow();
  });

  it('documents only routes the API really has (a renamed or removed route fails here)', () => {
    const real = apiRoutes();
    for (const o of ops) {
      const path = o.path.replace(/\{(\w+)\}/g, ':$1');
      expect(real.has(`${o.method} ${path}`), `${o.method} ${o.path} is not a registered API route`).toBe(true);
    }
  });

  it('lists the same categories as the API\'s pricing table', () => {
    const src = readFileSync(resolve(__dirname, '../../../api/src/domain/pricing.ts'), 'utf8');
    const block = /CATEGORIES: Record<Category, number> = \{([^}]*)\}/.exec(src)?.[1] ?? '';
    const real = Object.fromEntries([...block.matchAll(/(\w+):\s*([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
    expect(CATEGORY_LOADS).toEqual(real);
  });

  it('lists the deal statuses of the API', () => {
    const src = readFileSync(resolve(__dirname, '../../../api/src/storage/db.types.ts'), 'utf8');
    const block = /export type TxStatus =([^;]*);/.exec(src)?.[1] ?? '';
    const real = [...block.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    const documented = (spec.components.schemas.TransactionSummary.properties.status as { enum: string[] }).enum;
    expect([...documented].sort()).toEqual([...real].sort());
  });

  it('flattens request bodies into field rows, with required markers', () => {
    const create = ops.find((o) => o.id === 'createTransaction')!;
    const names = create.body!.fields.map((f) => f.name);
    expect(names).toEqual(['quoteId', 'terms', 'terms.spec', 'terms.priceCents', 'terms.deliverBy']);
    expect(create.body!.fields.every((f) => f.required)).toBe(true);
    expect(fieldsOf(resolveRef('#/components/schemas/Policy')).map((f) => f.name)).toContain('minCounterpartyScore');
  });

  it('marks the health check public and everything else signed', () => {
    for (const o of ops) expect(o.signed, o.id).toBe(o.id !== 'health');
  });
});
