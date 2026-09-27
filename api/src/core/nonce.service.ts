import { Injectable } from '@nestjs/common';
import { MongoService, isDuplicateKey } from '../storage/mongo.service';

// Replay protection for signed agent requests: a (agent, nonce) pair may be used once. The nonce is the row's
// _id, so the database itself refuses a second use, correctly even with several servers or after a restart.
// Rows are garbage-collected an hour later (a request is only accepted within 5 minutes of its timestamp).
@Injectable()
export class NonceService {
  constructor(private readonly mongo: MongoService) {}

  async use(key: string): Promise<boolean> {
    try {
      await this.mongo.col('nonces').insertOne({ _id: key as never, gcAt: new Date(Date.now() + 3_600_000) });
      return true;
    } catch (e) {
      if (isDuplicateKey(e)) return false;
      throw e;
    }
  }
}
