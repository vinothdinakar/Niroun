import { describe, expect, it } from 'vitest';
import { groupBy4, scoreColor, tokenFromHash, usd, usd0 } from './format';

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
