import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { HttpError } from './http-error';
import { BondRequest } from './request';

const MAX_BODY = 1_000_000;
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// This server only speaks JSON (the dashboard is its own app), so it forbids everything by default.
const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

// Runs first on every request, in this order:
//   1. security headers
//   2. who is calling (address for rate limiting)
//   3. Origin check: a cookie-authenticated write must come from us or from the dashboard we were told to trust
//   4. read the body once, keeping the exact text (agent signatures cover it) and parsing it as a JSON object
@Injectable()
export class EdgeMiddleware implements NestMiddleware {
  private readonly trustedOrigins: Set<string>;

  constructor(@Inject(BOND_OPTIONS) private readonly options: BondOptions) {
    this.trustedOrigins = new Set(options.allowedOrigins.map((o) => new URL(o).origin));
  }

  async use(req: BondRequest, res: Response, next: NextFunction): Promise<void> {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    req.clientIp = this.clientIp(req);
    this.checkOrigin(req);
    await this.readBody(req);
    next();
  }

  /** The client's address, for rate limiting. Only believe X-Forwarded-For when told a trusted proxy sets it. */
  private clientIp(req: BondRequest): string {
    if (this.options.trustProxy) {
      const first = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
      if (first) return first;
    }
    return req.socket.remoteAddress || 'unknown';
  }

  // Browsers always send Origin on cross-site writes. It must be us, or the dashboard we were told to trust
  // (defence in depth on top of SameSite=Strict).
  private checkOrigin(req: BondRequest): void {
    const origin = req.headers.origin;
    if (!UNSAFE.has(req.method) || !origin) return;
    let parsed: URL | null = null;
    try { parsed = new URL(origin); } catch { /* fall through to refusal */ }
    if (!parsed || (parsed.host !== req.headers.host && !this.trustedOrigins.has(parsed.origin))) {
      throw new HttpError(403, 'BAD_ORIGIN', 'Cross-origin request refused');
    }
  }

  private async readBody(req: BondRequest): Promise<void> {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      req.rawBody = '';
      req.body = {};
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY) throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body too large');
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    req.rawBody = raw;
    if (!raw) {
      req.body = {};
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'INVALID_JSON', 'Body must be valid JSON');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'INVALID_JSON', 'Body must be a JSON object');
    req.body = parsed;
  }
}
