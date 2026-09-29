import type { Request } from 'express';
import { User } from '../storage/db.types';

/** Who is calling, worked out by AuthGuard. Agents and console users are mutually exclusive per request. */
export interface Principal {
  agentId?: string;
  proof?: { reqHash: string };
  user?: User;
  sessionToken?: string;
}

export interface BondRequest extends Request {
  /** The exact bytes of the body, as text. Agent signatures are checked against this, not against parsed JSON. */
  rawBody?: string;
  /** The raw bytes of an evidence-file upload (the one route whose body is a file, not JSON). */
  upload?: Buffer;
  /** The caller's address for rate limiting (honours X-Forwarded-For only when a proxy is trusted). */
  clientIp?: string;
  principal?: Principal;
}
