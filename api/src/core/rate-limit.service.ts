import { Injectable } from '@nestjs/common';
import { HttpError } from '../common/http-error';
import { ClockService } from './clock.service';

interface Counter { count: number; first: number }

export const LOCK_WINDOW_MS = 15 * 60_000;

// In-memory counters for failed sign-ins and signup attempts. Move to Redis when there is more than one server.
@Injectable()
export class RateLimitService {
  private readonly fails = new Map<string, Counter>();
  private readonly hits = new Map<string, Counter>();

  constructor(private readonly clock: ClockService) {}

  // ---- failure counters (sign-in, two-factor codes): locked once `max` failures land inside the window ----
  isLocked(key: string, max: number): boolean {
    const r = this.fails.get(key);
    return !!r && r.count >= max && this.clock.now() - r.first < LOCK_WINDOW_MS;
  }

  recordFailure(key: string): void {
    const now = this.clock.now();
    const r = this.fails.get(key);
    if (!r || now - r.first >= LOCK_WINDOW_MS) this.fails.set(key, { count: 1, first: now });
    else r.count++;
  }

  clear(key: string): void {
    this.fails.delete(key);
  }

  // ---- attempt counters (signups, resending a verification email/code): throws 429 once `max` land inside the window ----
  hit(key: string, max: number, windowMs = 60 * 60_000, code = 'TOO_MANY_SIGNUPS', message = 'Too many attempts. Please try again later.'): void {
    const now = this.clock.now();
    if (this.hits.size > 5000) for (const [k, r] of this.hits) if (now - r.first >= windowMs) this.hits.delete(k);
    const r = this.hits.get(key);
    if (!r || now - r.first >= windowMs) {
      this.hits.set(key, { count: 1, first: now });
      return;
    }
    if (r.count >= max) throw new HttpError(429, code, message);
    r.count++;
  }
}
