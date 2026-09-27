/**
 * Background processing for course materials: an in-process queue with a global concurrency limit.
 * The database is the source of truth — on restart, unfinished materials are picked up again —
 * so a later move to a real job queue (e.g. pg-boss) only has to replace this file.
 */
import { and, inArray, isNotNull, lt, eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { courseMaterials } from '../../db/schema.js';
import { storage } from '../../storage/index.js';

type Processor = (materialId: string, signal: AbortSignal) => Promise<void>;

class MaterialJobs {
  private queue: string[] = [];
  private running = new Map<string, AbortController>();
  private waiters: (() => void)[] = [];
  private processor: Processor | null = null;

  constructor(private concurrency: number) {}

  setProcessor(fn: Processor) {
    this.processor = fn;
  }

  enqueue(id: string) {
    if (this.running.has(id) || this.queue.includes(id)) return;
    this.queue.push(id);
    this.pump();
  }

  /** Stops a queued or running job (material or course deleted). */
  cancel(id: string) {
    this.queue = this.queue.filter((q) => q !== id);
    this.running.get(id)?.abort(new Error('cancelled'));
  }

  isActive(id: string) {
    return this.running.has(id) || this.queue.includes(id);
  }

  /** Resolves once nothing is queued or running (tests, graceful shutdown). */
  idle(): Promise<void> {
    if (!this.queue.length && !this.running.size) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private pump() {
    while (this.processor && this.running.size < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      const ac = new AbortController();
      this.running.set(id, ac);
      this.processor(id, ac.signal)
        .catch((err) => console.error(`[materials] job ${id} crashed:`, err))
        .finally(() => {
          this.running.delete(id);
          this.pump();
          if (!this.queue.length && !this.running.size) this.waiters.splice(0).forEach((w) => w());
        });
    }
  }
}

export const materialJobs = new MaterialJobs(config.MEDIA_MAX_CONCURRENT_JOBS);

/** Re-queue materials left unfinished by a restart. */
export async function resumeMaterialJobs() {
  const rows = await db
    .select({ id: courseMaterials.id })
    .from(courseMaterials)
    .where(inArray(courseMaterials.status, ['processing', 'transcribing', 'analyzing']));
  for (const { id } of rows) materialJobs.enqueue(id);
}

/**
 * Storage policy: audio/video is deleted as soon as it's transcribed. A FAILED upload keeps its file
 * for MEDIA_FAILED_RETENTION_DAYS so the student can retry, then the file is deleted too.
 */
export async function purgeExpiredMedia(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.MEDIA_FAILED_RETENTION_DAYS * 86_400_000);
  const rows = await db
    .select({ id: courseMaterials.id, fileKey: courseMaterials.fileKey })
    .from(courseMaterials)
    .where(and(eq(courseMaterials.status, 'failed'), isNotNull(courseMaterials.fileKey), inArray(courseMaterials.kind, ['audio', 'video']), lt(courseMaterials.updatedAt, cutoff)));
  for (const r of rows) {
    await storage.delete(r.fileKey!).catch((err) => console.error(`[materials] purge ${r.id}:`, err));
    await db.update(courseMaterials).set({ fileKey: null, mediaDeletedAt: now }).where(eq(courseMaterials.id, r.id));
  }
  return rows.length;
}

/** Runs the purge now and every 6 hours (timer doesn't keep the process alive). */
export function startMaterialMaintenance() {
  const run = () => purgeExpiredMedia().catch((err) => console.error('[materials] purge failed', err));
  void run();
  setInterval(run, 6 * 3600_000).unref();
}
