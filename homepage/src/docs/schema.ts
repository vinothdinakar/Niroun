import { spec, type Json } from './spec';

export type Schema = Json;

const asObj = (v: unknown): Schema | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Schema) : undefined);

export function resolveRef(ref: string): Schema {
  const path = ref.replace(/^#\//, '').split('/');
  let cur: unknown = spec;
  for (const p of path) cur = asObj(cur)?.[p];
  const found = asObj(cur);
  if (!found) throw new Error(`Unresolvable $ref ${ref}`);
  return found;
}

/** Follows `$ref` and merges `allOf` into one object schema. */
export function flatten(s: Schema): Schema {
  if (typeof s.$ref === 'string') return flatten({ ...resolveRef(s.$ref), ...omit(s, '$ref') });
  if (Array.isArray(s.allOf)) {
    const parts = (s.allOf as Schema[]).map(flatten);
    return {
      ...omit(s, 'allOf'),
      type: 'object',
      properties: Object.assign({}, ...parts.map((p) => p.properties ?? {})),
      required: parts.flatMap((p) => (p.required as string[] | undefined) ?? []),
    };
  }
  return s;
}

function omit(o: Schema, key: string): Schema {
  const { [key]: _drop, ...rest } = o;
  return rest;
}

export function typeOf(s: Schema): string {
  if (typeof s.$ref === 'string') return s.$ref.split('/').pop() as string;
  if ('const' in s) return JSON.stringify(s.const);
  if (Array.isArray(s.enum)) return (s.enum as unknown[]).map((v) => (v === null ? 'null' : String(v))).join(' | ');
  if (Array.isArray(s.oneOf)) return (s.oneOf as Schema[]).map(typeOf).join(' | ');
  if (Array.isArray(s.allOf)) return (s.allOf as Schema[]).map(typeOf).join(' & ');
  if (Array.isArray(s.type)) return (s.type as string[]).join(' | ');
  if (s.type === 'array') return `${typeOf(asObj(s.items) ?? {})}[]`;
  return typeof s.type === 'string' ? s.type : 'object';
}

export interface Field { name: string; type: string; required: boolean; description: string; depth: number }

/** A schema's properties as table rows, nesting into inline objects (but not into named schemas). */
export function fieldsOf(schema: Schema, depth = 0, prefix = ''): Field[] {
  const s = flatten(schema);
  const props = asObj(s.properties);
  if (!props) return [];
  const required = new Set((s.required as string[] | undefined) ?? []);
  const rows: Field[] = [];
  for (const [name, raw] of Object.entries(props)) {
    const p = asObj(raw) ?? {};
    const resolved = typeof p.$ref === 'string' ? { ...resolveRef(p.$ref), ...omit(p, '$ref') } : p;
    const description = String(p.description ?? resolved.description ?? '');
    const extra = 'default' in resolved && resolved.default !== undefined ? ` Default: ${JSON.stringify(resolved.default)}.` : '';
    rows.push({ name: prefix + name, type: typeOf(p), required: required.has(name), description: description + extra, depth });
    if (!p.$ref && p.type === 'object' && asObj(p.properties)) rows.push(...fieldsOf(p, depth + 1, `${prefix}${name}.`));
  }
  return rows;
}

export interface Operation {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  id: string;
  tag: string;
  summary: string;
  description: string;
  signed: boolean;
  parameters: { name: string; in: string; required: boolean; description: string; type: string }[];
  body?: { fields: Field[]; example?: unknown };
  responses: { status: string; description: string; example?: unknown }[];
}

const METHODS = ['get', 'post', 'put', 'delete'] as const;

export function operations(): Operation[] {
  const out: Operation[] = [];
  for (const [path, item] of Object.entries(spec.paths as Record<string, Schema>)) {
    for (const m of METHODS) {
      const op = asObj(item[m]);
      if (!op) continue;
      const body = asObj(asObj(asObj(asObj(op.requestBody)?.content)?.['application/json']));
      const responses = Object.entries(asObj(op.responses) ?? {}).map(([status, r]) => {
        const media = asObj(asObj(asObj(asObj(r)?.content)?.['application/json']));
        return { status, description: String(asObj(r)?.description ?? ''), example: media?.example };
      });
      out.push({
        method: m.toUpperCase() as Operation['method'],
        path,
        id: String(op.operationId),
        tag: String((op.tags as string[])[0]),
        summary: String(op.summary),
        description: String(op.description ?? ''),
        signed: !Array.isArray(op.security) || (op.security as unknown[]).length > 0,
        parameters: ((op.parameters as Schema[] | undefined) ?? []).map((p) => ({
          name: String(p.name), in: String(p.in), required: p.required === true,
          description: String(p.description ?? ''), type: typeOf(asObj(p.schema) ?? {}),
        })),
        body: body ? { fields: fieldsOf(asObj(body.schema) ?? {}), example: body.example } : undefined,
        responses,
      });
    }
  }
  return out;
}
