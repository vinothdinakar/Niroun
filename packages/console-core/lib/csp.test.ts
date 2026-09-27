import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(name + ' ')) ?? '';

describe('buildCsp', () => {
  it('only lets scripts run with this request\'s nonce', () => {
    const csp = buildCsp('N0NCE', false);
    expect(directive(csp, 'script-src')).toContain("'nonce-N0NCE'");
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
    expect(directive(csp, 'script-src')).not.toContain('unsafe-eval');
  });

  it('forbids framing, plugins, and talking to anyone but ourselves', () => {
    const csp = buildCsp('n', false);
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self'");
    expect(directive(csp, 'form-action')).toBe("form-action 'self'");
  });

  it('allows eval only in development, for hot reload', () => {
    expect(directive(buildCsp('n', true), 'script-src')).toContain("'unsafe-eval'");
    expect(directive(buildCsp('n', false), 'script-src')).not.toContain("'unsafe-eval'");
  });
});
