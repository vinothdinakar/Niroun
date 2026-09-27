import { Injectable } from '@nestjs/common';
import { MongoService } from '../storage/mongo.service';
import { ClockService } from './clock.service';
import { AuditEntry } from '../storage/db.types';

// Who did what in the console: sign-ins, signups, and every change. Newest first when listed.
// Unbounded for now: add a retention policy (or archive to cold storage) before this grows large.
@Injectable()
export class AuditService {
  constructor(private readonly mongo: MongoService, private readonly clock: ClockService) {}

  async record(actor: { id: string; email: string } | null, action: string, target: string | null = null, detail: Record<string, unknown> = {}): Promise<void> {
    await this.mongo.col('audit').insertOne(
      { ts: this.clock.now(), actor: actor?.id ?? null, actorEmail: actor?.email ?? null, action, target, detail },
      this.mongo.tx,
    );
  }

  async list(limit = 200): Promise<AuditEntry[]> {
    const docs = await this.mongo.col('audit').find({}, { sort: { _id: -1 }, limit, ...this.mongo.tx }).toArray();
    return docs.map(({ _id, ...rest }) => rest as unknown as AuditEntry);
  }
}
