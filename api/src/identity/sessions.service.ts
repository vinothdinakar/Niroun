import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from '../core/clock.service';
import { User } from '../storage/db.types';
import { sha256 } from '../domain/canonical';
import { isStaff } from '../domain/roles';

const HOUR = 3_600_000;
export const SESSION_IDLE_MS = 2 * HOUR;
export const SESSION_MAX_MS = 12 * HOUR;

/** Where a session came from, for the "active sessions" list — best-effort, never trusted for security decisions. */
export interface SessionMeta { ip?: string; userAgent?: string | null }
export interface SessionRow { id: string; current: boolean; createdAt: number; lastSeen: number; ip: string; userAgent: string | null }

// Server-side sessions. The browser holds a random token; we store only its hash (as the row's _id).
// `gcAt` is a wall-clock date that lets MongoDB clean up long-dead rows; validity itself is checked in code.
@Injectable()
export class SessionsService {
  constructor(private readonly mongo: MongoService, private readonly clock: ClockService) {}

  private get col() {
    return this.mongo.col('sessions');
  }

  async start(user: User, mfa: boolean, meta: SessionMeta = {}): Promise<{ token: string; user: User }> {
    // Belt and braces: no code path may mint a staff session that skipped the second factor.
    if (isStaff(user) && !mfa) throw new Error('refusing to create a staff session without two-factor');
    const token = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    await this.col.insertOne(
      {
        _id: sha256(token) as never, userId: user.id, createdAt: now, lastSeen: now, mfa,
        ip: meta.ip || 'unknown', userAgent: meta.userAgent || null,
        gcAt: new Date(Date.now() + 2 * SESSION_MAX_MS),
      },
      this.mongo.tx,
    );
    return { token, user };
  }

  /** The signed-in user for a session token, or null. Sessions expire when idle or after a fixed lifetime. */
  async userFor(token: string | undefined): Promise<User | null> {
    if (!token) return null;
    const id = sha256(token) as never;
    const s = await this.col.findOne({ _id: id }, this.mongo.tx);
    if (!s) return null;
    const now = this.clock.now();
    const user = await this.mongo.users.get(s.userId as string);
    // A staff session that never passed two-factor is never valid (defends against old or forged session records).
    if (!user || user.disabled || (isStaff(user) && !s.mfa) || now - (s.lastSeen as number) > SESSION_IDLE_MS || now - (s.createdAt as number) > SESSION_MAX_MS) {
      await this.col.deleteOne({ _id: id }, this.mongo.tx);
      return null;
    }
    if (now - (s.lastSeen as number) > 60_000) await this.col.updateOne({ _id: id }, { $set: { lastSeen: now } }, this.mongo.tx);
    return user;
  }

  async end(token: string | undefined): Promise<void> {
    if (token) await this.col.deleteOne({ _id: sha256(token) as never }, this.mongo.tx);
  }

  /** Sign a user out everywhere (optionally keeping the session they're using right now). Returns how many ended. */
  async revokeAll(userId: string, exceptToken: string | null = null): Promise<number> {
    const filter: Record<string, unknown> = { userId };
    if (exceptToken) filter._id = { $ne: sha256(exceptToken) };
    const res = await this.col.deleteMany(filter, this.mongo.tx);
    return res.deletedCount ?? 0;
  }

  /** Every live session for a person (their own "active sessions" list), most recently used first. Rows
   * `userFor` would reject as expired (idle or past their lifetime, just not yet garbage-collected) are left
   * out rather than deleted here — this is a read, and the next real use of that session will clean it up. */
  async list(userId: string, currentToken: string | undefined): Promise<SessionRow[]> {
    const currentId = currentToken ? sha256(currentToken) : null;
    const now = this.clock.now();
    const docs = await this.col.find({ userId }, { sort: { lastSeen: -1 }, ...this.mongo.tx }).toArray();
    return docs
      .filter((s) => now - (s.lastSeen as number) <= SESSION_IDLE_MS && now - (s.createdAt as number) <= SESSION_MAX_MS)
      .map((s) => ({
        id: String(s._id),
        current: currentId !== null && String(s._id) === currentId,
        createdAt: s.createdAt as number,
        lastSeen: s.lastSeen as number,
        ip: (s.ip as string | undefined) || 'unknown',
        userAgent: (s.userAgent as string | null | undefined) ?? null,
      }));
  }

  /** End one specific session belonging to `userId` (ownership checked here, so nobody can end someone else's by guessing an id). */
  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const res = await this.col.deleteOne({ _id: sessionId as never, userId }, this.mongo.tx);
    return res.deletedCount > 0;
  }
}
