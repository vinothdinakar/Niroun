import { describe, expect, it } from 'vitest';
import { groupBy4, scoreColor, tokenFromHash, usd, usd0, formatDateTime, setDisplayPrefs, when } from './format';

describe('money', () => {
  it('formats cents as dollars', () => {
    expect(usd(123456)).toBe('$1,234.56');
    expect(usd(5)).toBe('$0.05');
    expect(usd0(123456)).toBe('$1,235');
  });
});

describe('scoreColor', () => {
  it('follows the tier boundaries', () => {
    expect(scoreColor(900)).toBe('var(--green)');
    expect(scoreColor(850)).toBe('var(--green)');
    expect(scoreColor(849)).toBe('var(--accent)');
    expect(scoreColor(550)).toBe('var(--amber)');
    expect(scoreColor(400)).toBe('var(--orange)');
    expect(scoreColor(399)).toBe('var(--red)');
  });
});

describe('tokenFromHash', () => {
  it('accepts only "#token=<token>"', () => {
    expect(tokenFromHash('#token=abc_DEF-123')).toBe('abc_DEF-123');
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#token=')).toBeNull();
    expect(tokenFromHash('#verify=abc')).toBeNull();
    expect(tokenFromHash('#token=abc&x=1')).toBeNull();
    expect(tokenFromHash('#token=abc"><script>')).toBeNull();
  });
});

describe('groupBy4', () => {
  it('splits a secret into readable blocks', () => {
    expect(groupBy4('ABCDEFGHIJ')).toBe('ABCD EFGH IJ');
    expect(groupBy4('')).toBe('');
  });
});

describe('formatDateTime', () => {
  const t = Date.UTC(2026, 8, 30, 4, 52); // 04:52 UTC, which is 00:52 in Toronto (UTC-4)
  const none = { timeZone: null, dateFormat: null, timeFormat: null } as const;

  it('shows a dash for no time', () => {
    expect(formatDateTime(null, none)).toBe('—');
    expect(formatDateTime(0, none)).toBe('—');
  });

  it('follows the chosen time zone, date order and 24-hour clock', () => {
    expect(formatDateTime(t, { timeZone: 'America/Toronto', dateFormat: 'YMD', timeFormat: '24h' })).toBe('2026-09-30, 00:52');
    expect(formatDateTime(t, { timeZone: 'UTC', dateFormat: 'DMY', timeFormat: '24h' })).toBe('30/09/2026, 04:52');
    expect(formatDateTime(t, { timeZone: 'UTC', dateFormat: 'MDY', timeFormat: '24h' })).toBe('09/30/2026, 04:52');
  });

  it('can show the same moment on a different day in another zone', () => {
    expect(formatDateTime(t, { timeZone: 'Pacific/Auckland', dateFormat: 'YMD', timeFormat: '24h' })).toBe('2026-09-30, 17:52');
    expect(formatDateTime(t, { timeZone: 'America/Los_Angeles', dateFormat: 'YMD', timeFormat: '24h' })).toBe('2026-09-29, 21:52');
  });

  it('uses a 12-hour clock with AM/PM when asked', () => {
    expect(formatDateTime(t, { timeZone: 'America/Toronto', dateFormat: null, timeFormat: '12h' })).toMatch(/12:52\s?AM/);
  });

  it('through when(), follows whatever setDisplayPrefs last set, and resets with null', () => {
    setDisplayPrefs({ timeZone: 'UTC', dateFormat: 'YMD', timeFormat: '24h' });
    expect(when(t)).toBe('2026-09-30, 04:52');
    setDisplayPrefs(null);
    expect(when(t)).toBe(formatDateTime(t, none));
  });
});
