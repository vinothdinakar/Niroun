import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BOND_OPTIONS, BondOptions } from '../config/options';
import { MongoService } from '../storage/mongo.service';
import { newId } from '../storage/ids';
import { ClockService } from '../core/clock.service';
import { AuditService } from '../core/audit.service';
import { HttpError, badRequest, notFound } from '../common/http-error';
import { AccountType, DocumentKind, User, VerificationDocument, VerificationRequest } from '../storage/db.types';
import { can } from '../domain/roles';
import { OrgsService } from './orgs.service';

// The evidence a business vs. an individual attaches to a verification application. Order is display order.
const DOC_SPEC: Record<AccountType, { kind: DocumentKind; required: boolean }[]> = {
  business: [{ kind: 'incorporation', required: true }, { kind: 'address_proof', required: false }],
  individual: [{ kind: 'id_document', required: true }, { kind: 'address_proof', required: false }],
};

export const MAX_DOC_BYTES = 5 * 1024 * 1024;
const MAX_UNATTACHED = 10; // per org: caps what an admin can park in storage without ever submitting
const ABANDONED_AFTER_MS = 24 * 3_600_000; // an upload that never made it into a submitted request
const DAY_MS = 24 * 3_600_000;

// Declared type -> what the file's first bytes must look like. Trusting only the header would let a script
// or an HTML page be stored under a friendly name.
const SIGNATURES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46, 0x2d],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

/** What a caller sees of a document: everything except where the bytes are stored. */
export type DocumentView = Omit<VerificationDocument, 'storageKey'>;
const view = ({ storageKey: _k, ...rest }: VerificationDocument): DocumentView => rest;

const cleanFilename = (raw: unknown): string => {
  const base = String(raw ?? '').split(/[\\/]/).pop() ?? '';
  // control characters and quotes would corrupt the download header; keep it short and readable
  const name = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().slice(0, 120);
  return name || 'document';
};

// KYB/KYC evidence: certificate of incorporation, ID. Files go to a private FileStore (Google Cloud Storage in
// production); this service owns the rules around them: who may upload and read, what is accepted, and how long
// they are kept. Nothing here is ever served from a public URL: reads go through the API, are authorised per
// request, and staff reads are audited.
@Injectable()
export class VerificationDocumentsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('VerificationDocuments');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(BOND_OPTIONS) private readonly options: BondOptions,
    private readonly mongo: MongoService,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly orgs: OrgsService,
  ) {}

  private get col() {
    return this.mongo.verificationDocuments;
  }

  private get store() {
    return this.options.fileStore;
  }

  spec(accountType: AccountType) {
    return DOC_SPEC[accountType];
  }

  async upload(user: User, kindInput: unknown, filename: unknown, contentType: unknown, data: Buffer | undefined): Promise<DocumentView> {
    if (!can(user, 'request_verification')) throw new HttpError(403, 'FORBIDDEN', 'Only an organization\'s own admin can upload verification documents');
    const org = await this.orgs.orThrow(user.orgId);
    const kind = DOC_SPEC[org.accountType].find((d) => d.kind === kindInput)?.kind;
    if (!kind) throw badRequest('INVALID_DOCUMENT_KIND', `kind must be one of: ${DOC_SPEC[org.accountType].map((d) => d.kind).join(', ')}`);

    const type = String(contentType ?? '').split(';')[0].trim().toLowerCase();
    const signature = SIGNATURES[type];
    if (!signature) throw new HttpError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload a PDF, PNG or JPEG file');
    if (!data || data.length === 0) throw badRequest('EMPTY_FILE', 'The file is empty');
    if (data.length > MAX_DOC_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', `Files can be at most ${MAX_DOC_BYTES / 1024 / 1024} MB`);
    if (!signature.every((b, i) => data[i] === b)) throw new HttpError(415, 'FILE_TYPE_MISMATCH', 'The file\'s contents do not match its type');

    if (await this.col.count({ orgId: org.id, requestId: { $exists: false }, purgedAt: { $exists: false } }) >= MAX_UNATTACHED) {
      throw new HttpError(429, 'TOO_MANY_UPLOADS', 'Submit your application, or wait a day for unused uploads to clear, before uploading more');
    }

    const id = newId('doc');
    const doc: VerificationDocument = {
      id, orgId: org.id, kind, filename: cleanFilename(filename), contentType: type, size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      storageKey: `verification/${org.id}/${id}`, uploadedBy: user.id, uploadedAt: this.clock.now(),
    };
    // bytes first: a metadata row must never point at nothing
    await this.store.put(doc.storageKey, data, type);
    try {
      await this.col.insert(doc);
    } catch (e) {
      await this.store.delete(doc.storageKey).catch(() => undefined);
      throw e;
    }
    return view(doc);
  }

  /** Checks the uploaded files an application names and binds them to it. Call inside the submit transaction. */
  async attach(orgId: string, accountType: AccountType, requestId: string, idsInput: unknown): Promise<string[]> {
    const ids = Array.isArray(idsInput) ? idsInput.map(String) : [];
    if (new Set(ids).size !== ids.length) throw badRequest('DUPLICATE_DOCUMENT', 'A document was listed twice');
    const docs = await this.col.getMany(ids);
    if (docs.length !== ids.length) throw badRequest('UNKNOWN_DOCUMENT', 'One of the documents does not exist');
    // A file already on a rejected or withdrawn application can move to the next one (edit and resubmit); one on a
    // pending or approved application cannot.
    const previous = new Map<string, VerificationRequest>();
    for (const d of docs) {
      if (d.orgId !== orgId) throw badRequest('UNKNOWN_DOCUMENT', 'One of the documents does not exist'); // same answer: don't reveal other orgs' ids
      const unavailable = () => badRequest('DOCUMENT_UNAVAILABLE', `${d.filename} was already used or has been removed; upload it again`);
      if (d.purgedAt) throw unavailable();
      if (d.requestId) {
        const old = await this.mongo.verificationRequests.get(d.requestId);
        if (!old || (old.status !== 'rejected' && old.status !== 'withdrawn')) throw unavailable();
        previous.set(old.id, old);
      }
    }
    const kinds = docs.map((d) => d.kind);
    if (new Set(kinds).size !== kinds.length) throw badRequest('DUPLICATE_DOCUMENT_KIND', 'Attach at most one document of each kind');
    for (const { kind, required } of DOC_SPEC[accountType]) {
      if (required && !kinds.includes(kind)) throw badRequest('MISSING_DOCUMENT', `A ${kind} document is required`);
    }
    for (const d of docs) {
      d.requestId = requestId;
      await this.col.save(d);
    }
    // the file now belongs to the new application only, so the old one's retention clock can't delete it early
    for (const old of previous.values()) {
      old.documentIds = old.documentIds.filter((id) => !ids.includes(id));
      await this.mongo.verificationRequests.save(old);
    }
    return ids;
  }

  async forRequests(ids: string[]): Promise<Map<string, DocumentView>> {
    const docs = await this.col.getMany(ids);
    return new Map(docs.map((d) => [d.id, view(d)]));
  }

  /** A file's bytes, for its own org's admin or for staff. Staff reads (someone else's identity documents) are audited. */
  async read(user: User, id: string): Promise<{ doc: DocumentView; data: Buffer }> {
    const doc = await this.col.get(id);
    const staff = can(user, 'verify');
    const own = !staff && can(user, 'request_verification') && user.orgId === doc?.orgId;
    if (!doc || !(staff || own)) throw notFound('DOCUMENT_NOT_FOUND', `Unknown document ${id}`); // 404 for both: don't confirm ids exist
    if (doc.purgedAt) throw new HttpError(410, 'DOCUMENT_PURGED', 'This document was deleted under the retention policy');
    const data = await this.store.get(doc.storageKey);
    if (staff) await this.audit.record(user, 'verification.document_view', doc.id, { orgId: doc.orgId, requestId: doc.requestId, kind: doc.kind });
    return { doc: view(doc), data };
  }

  /**
   * The retention policy. Files are deleted (bytes gone, metadata kept) when:
   *  - they were uploaded but never attached to a submitted application, after a day; or
   *  - their application was decided `docRetentionDays` ago (approved or rejected alike).
   * Returns how many files were deleted. A backstop lifecycle rule on the bucket should cover the same window.
   */
  async purgeExpired(): Promise<number> {
    const now = this.clock.now();
    const stale: VerificationDocument[] = await this.col.find({ requestId: { $exists: false }, purgedAt: { $exists: false }, uploadedAt: { $lt: now - ABANDONED_AFTER_MS } });
    const cutoff = now - this.options.docRetentionDays * DAY_MS;
    const decided = await this.mongo.verificationRequests.find({ status: { $ne: 'pending' }, decidedAt: { $lt: cutoff } });
    const ids = decided.flatMap((r) => r.documentIds ?? []);
    if (ids.length) stale.push(...(await this.col.getMany(ids)).filter((d) => !d.purgedAt));

    let purged = 0;
    for (const d of stale) {
      try {
        await this.store.delete(d.storageKey);
        d.purgedAt = now;
        await this.col.save(d);
        await this.audit.record(null, 'verification.document_purge', d.id, { orgId: d.orgId, requestId: d.requestId ?? null });
        purged++;
      } catch (e) {
        this.log.error(`could not purge ${d.id}: ${(e as Error).message}`); // retried on the next run
      }
    }
    return purged;
  }

  onModuleInit(): void {
    if (this.options.sweepIntervalMs > 0) {
      this.timer = setInterval(() => void this.tick(), this.options.sweepIntervalMs);
      this.timer.unref?.();
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.purgeExpired();
    } catch (e) {
      this.log.error(`document purge failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
