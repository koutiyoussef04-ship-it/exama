/**
 * File storage abstraction. Local disk for development;
 * add an S3/R2/GCS implementation of FileStorage for production.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';

/** Thrown by putStream when the upload is larger than allowed (the partial file is removed). */
export class StorageLimitError extends Error {
  constructor(public maxBytes: number) {
    super(`Upload exceeds ${maxBytes} bytes`);
  }
}

export interface FileStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  /** Deletes every file under a prefix (e.g. all of a user's uploads: "<userId>/"). */
  deletePrefix(prefix: string): Promise<void>;
  /**
   * Streams an upload to storage without holding it in memory. Stops (and cleans up) as soon as
   * more than `maxBytes` arrive. Resolves with the stored size.
   */
  putStream(key: string, body: Readable | ReadableStream<Uint8Array>, maxBytes: number): Promise<number>;
  /** Streams a stored file (e.g. to a transcription provider). */
  readStream(key: string): Readable;
  /** Reads `length` bytes at `start` (short at end of file) — used to inspect media headers. */
  readRange(key: string, start: number, length: number): Promise<Uint8Array>;
  size(key: string): Promise<number>;
}

export class LocalDiskStorage implements FileStorage {
  private root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string) {
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }
  async put(key: string, data: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data);
  }
  async get(key: string) {
    return new Uint8Array(await readFile(this.path(key)));
  }
  async delete(key: string) {
    await rm(this.path(key), { force: true });
  }
  async putStream(key: string, body: Readable | ReadableStream<Uint8Array>, maxBytes: number) {
    const p = this.path(key);
    const tmp = `${p}.part`;
    await mkdir(dirname(p), { recursive: true });
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, done) {
        bytes += chunk.length;
        if (bytes > maxBytes) done(new StorageLimitError(maxBytes));
        else done(null, chunk);
      },
    });
    const source = body instanceof Readable ? body : Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>);
    try {
      await pipeline(source, limit, createWriteStream(tmp));
      await rename(tmp, p);
      return bytes;
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }
  readStream(key: string) {
    return createReadStream(this.path(key));
  }
  async readRange(key: string, start: number, length: number) {
    const fh = await open(this.path(key), 'r');
    try {
      const buf = Buffer.alloc(Math.max(0, length));
      const { bytesRead } = await fh.read(buf, 0, buf.length, start);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } finally {
      await fh.close();
    }
  }
  async size(key: string) {
    return (await stat(this.path(key))).size;
  }
  async deletePrefix(prefix: string) {
    const clean = prefix.replace(/\/+$/, '');
    if (!clean) throw new Error('Refusing to delete the storage root');
    await rm(this.path(clean), { recursive: true, force: true });
  }
}

export const storage: FileStorage = new LocalDiskStorage(config.STORAGE_DIR);
