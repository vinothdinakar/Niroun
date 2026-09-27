import { createHash } from 'node:crypto';

// Deterministic JSON: sorted keys, no whitespace. Used for every hash we commit to.
export function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
