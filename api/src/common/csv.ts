// A minimal RFC 4180 CSV writer. Row shapes across the export routes are flat (no nested objects/arrays
// beyond the odd string[], which callers join before handing it to csvRow), so this is all that's needed —
// not worth a dependency.
export const csvField = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const csvRow = (fields: unknown[]): string => fields.map(csvField).join(',') + '\r\n';
