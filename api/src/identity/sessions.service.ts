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

// Server-side sessions. The browser holds a random token; we store only its hash (as the row's _id).
// `gcAt` is a wall-clock date that lets MongoDB clean up long-dead rows; validity itself is checked in code.
@Injectable()
export class SessionsService {
  constructor(private readonly mongo: MongoService, private readonly clock: ClockService) {}

  private get col() {
    return this.mongo.col('sessions');
  }

  async start(user: User, mfa: boolean): Promise<{ token: string; user: User }> {
    // Belt and braces: no code path may mint a staff session that skipped the second factor.
    if (isStaff(user) && !mfa) throw new Error('refusing to create a staff session without two-factor');
    const token = randomBytes(32).toString('base64url');
    const now = this.clock.now();
    await this.col.insertOne(
      { _id: sha256(token) as never, userId: user.id, createdAt: now, lastSeen: now, mfa, gcAt: new Date(Date.now() + 2 * SESSION_MAX_MS) },
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

  /** Sign a user out everywhere (optionally keeping the session they're using right now). */
  async revokeAll(userId: string, exceptToken: string | null = null): Promise<void> {
    const filter: Record<string, unknown> = { userId };
    if (exceptToken) filter._id = { $ne: sha256(exceptToken) };
    await this.col.deleteMany(filter, this.mongo.tx);
  }
}
