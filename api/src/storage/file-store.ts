import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

// Where uploaded evidence files live. The database keeps only metadata; the bytes go through this interface so
// the backend can be Google Cloud Storage in production, a folder in dev, or memory in tests.
export interface FileStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  /** Idempotent: deleting a file that is already gone is not an error. */
  delete(key: string): Promise<void>;
}

/** The slice of a `@google-cloud/storage` Bucket we use, so tests can stand in a fake. */
export interface BucketLike {
  file(name: string): {
    save(data: Buffer, opts: { contentType: string; resumable: boolean }): Promise<unknown>;
    download(): Promise<[Buffer]>;
    delete(opts: { ignoreNotFound: boolean }): Promise<unknown>;
  };
}

export class GcsFileStore implements FileStore {
  constructor(private readonly bucket: BucketLike) {}

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.bucket.file(key).save(data, { contentType, resumable: false });
  }

  async get(key: string): Promise<Buffer> {
    const [data] = await this.bucket.file(key).download();
    return data;
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
}

/** Opens a bucket with Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS, or the runtime's service account). */
export async function openGcsBucket(name: string): Promise<GcsFileStore> {
  const { Storage } = await import('@google-cloud/storage');
  return new GcsFileStore(new Storage().bucket(name));
}

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Buffer>();

  async put(key: string, data: Buffer): Promise<void> {
    this.files.set(key, Buffer.from(data));
  }

  async get(key: string): Promise<Buffer> {
    const data = this.files.get(key);
    if (!data) throw new Error(`no such file: ${key}`);
    return Buffer.from(data);
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

/** Dev fallback when no bucket is configured: files in a local folder. Not for production. */
export class DiskFileStore implements FileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('invalid file key');
    return p;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
