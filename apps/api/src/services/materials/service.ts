/**
 * Course materials: lecture audio/video and extra PDFs added to an existing course.
 *
 * Everything feeds the SAME course: material text is stored as document_chunks (material_id set),
 * so exam generation, practice and the study planner read it like the original PDF; the topics a
 * material introduces are merged into documents.topics, so mastery, weak topics and the planner
 * pick them up. Processing runs in the background (./pipeline.ts); the app polls the status.
 */
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Readable } from 'node:stream';
import {
  MAX_MATERIALS_PER_COURSE,
  PPTX_MIME,
  type AiLanguage,
  type CourseMaterial,
  type CourseMaterialDetail,
  type LectureAllowance,
} from '@study/shared';
import { track } from '../../analytics/index.js';
import { assertCanUploadMaterial, reserveMaterialUpload, reserveMediaMinutes } from '../../billing/entitlements.js';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { courseMaterials, documents } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { mergeCourseTopics } from '../../lib/knowledge.js';
import { ProbeError, probeMedia } from '../../lib/media-probe.js';
import { RateLimiter } from '../../lib/rate-limit.js';
import { storage, StorageLimitError } from '../../storage/index.js';
import { transcriber } from '../../transcription/index.js';
import { getOwnedDocument } from '../documents.js';
import { materialJobs } from './jobs.js';

export type MaterialRow = typeof courseMaterials.$inferSelect;
type DocRow = typeof documents.$inferSelect;
type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/** Retries per material (the first attempt counts). */
export const MAX_ATTEMPTS = 3;
/** Failures a retry cannot fix: the file itself is the problem. */
const PERMANENT_FAILURES = new Set(['media_no_speech', 'media_unreadable', 'media_no_audio', 'pdf_no_text', 'pdf_unreadable', 'pptx_no_text', 'pptx_unreadable', 'material_no_topics']);
const ACTIVE = ['processing', 'transcribing', 'analyzing'] as const;

export const uploadLimiter = new RateLimiter(config.MEDIA_UPLOADS_PER_HOUR, 3600_000);

export function canRetry(m: MaterialRow): boolean {
  return (
    m.status === 'failed' &&
    m.attempts < MAX_ATTEMPTS &&
    !PERMANENT_FAILURES.has(m.errorCode ?? '') &&
    (m.failedStage === 'analysis' || m.kind === 'pdf' || !!m.fileKey)
  );
}

/** Only the beginning of the recording is (or will be) processed: its length exceeds the reserved minutes. */
const isPartial = (m: MaterialRow) => m.kind !== 'pdf' && !!m.originalDurationSeconds && m.billedMinutes > 0 && m.originalDurationSeconds > m.billedMinutes * 60;

export const toMaterialDto = (m: MaterialRow): CourseMaterial => ({
  id: m.id,
  documentId: m.documentId,
  primary: false,
  kind: m.kind,
  format: m.format,
  title: m.title,
  status: m.status,
  sizeBytes: m.sizeBytes,
  durationSeconds: m.durationSeconds,
  fullDurationSeconds: m.originalDurationSeconds ?? m.durationSeconds,
  partial: isPartial(m),
  processedMinutes: m.kind === 'pdf' ? null : m.billedMinutes || null,
  pageCount: m.pageCount,
  sourceLanguage: m.sourceLanguage,
  language: m.language,
  errorCode: m.errorCode,
  canRetry: canRetry(m),
  topics: m.topics,
  newTopics: m.newTopics,
  createdAt: m.createdAt.toISOString(),
  updatedAt: m.updatedAt.toISOString(),
  processedAt: m.processedAt?.toISOString() ?? null,
});

const toDetail = (m: MaterialRow): CourseMaterialDetail => ({ ...toMaterialDto(m), summary: m.summary, knowledge: m.knowledge ?? null });

/** The course's original PDF, shown first in the materials list (managed with the course itself). */
function primaryMaterial(doc: DocRow): CourseMaterial {
  return {
    id: doc.id,
    documentId: doc.id,
    primary: true,
    kind: 'pdf',
    format: doc.mimeType === PPTX_MIME ? 'pptx' : 'pdf',
    title: doc.title,
    status: doc.status,
    sizeBytes: doc.sizeBytes,
    durationSeconds: null,
    fullDurationSeconds: null,
    partial: false,
    processedMinutes: null,
    pageCount: doc.pageCount,
    sourceLanguage: doc.sourceLanguage,
    language: doc.summaryLanguage,
    errorCode: doc.errorCode,
    canRetry: false,
    topics: doc.baseTopics ?? doc.topics,
    newTopics: [],
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.createdAt.toISOString(),
    processedAt: null,
  };
}

// ---------------------------------------------------------------- reads

export async function listMaterials(userId: string, documentId: string): Promise<CourseMaterial[]> {
  const doc = await getOwnedDocument(userId, documentId);
  const rows = await db
    .select()
    .from(courseMaterials)
    .where(and(eq(courseMaterials.documentId, doc.id), eq(courseMaterials.userId, userId)))
    .orderBy(asc(courseMaterials.createdAt));
  return [primaryMaterial(doc), ...rows.map(toMaterialDto)];
}

async function getOwnedMaterial(userId: string, documentId: string, materialId: string): Promise<MaterialRow> {
  if (!/^[0-9a-f-]{36}$/i.test(materialId)) throw new HttpError(404, 'Material not found', 'not_found');
  const doc = await getOwnedDocument(userId, documentId); // 404 unless this user owns the course
  const [m] = await db
    .select()
    .from(courseMaterials)
    .where(and(eq(courseMaterials.id, materialId), eq(courseMaterials.documentId, doc.id), eq(courseMaterials.userId, userId)));
  if (!m) throw new HttpError(404, 'Material not found', 'not_found');
  return m;
}

export async function getMaterial(userId: string, documentId: string, materialId: string): Promise<CourseMaterialDetail> {
  return toDetail(await getOwnedMaterial(userId, documentId, materialId));
}

// ---------------------------------------------------------------- upload

/** Display name from the X-Exama-Title header: no paths, control characters or extension. */
export function cleanTitle(raw: string | null | undefined): string {
  let t = raw ?? '';
  try {
    t = decodeURIComponent(t);
  } catch {
    /* keep as-is */
  }
  return (t.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.(pdf|pptx|mp3|m4a|mp4|mov|wav|aac|m4v)$/i, '')
    .trim()
    .slice(0, 200);
}

const kindHint = (contentType: string | null): 'pdf' | 'media' | null => {
  const t = (contentType ?? '').toLowerCase();
  if (t.startsWith('application/pdf') || t.startsWith(PPTX_MIME)) return 'pdf';
  if (t.startsWith('audio/') || t.startsWith('video/')) return 'media';
  return null;
};

const PROBE_STATUS = { unsupported_format: 415, media_unreadable: 422, media_no_audio: 422, ppt_legacy: 415 } as const;

export type UploadRequest = {
  body: ReadableStream<Uint8Array> | Readable | null;
  contentType: string | null;
  contentLength: number | null;
  title: string | null;
  language: AiLanguage;
};

export async function createMaterial(userId: string, documentId: string, req: UploadRequest): Promise<CourseMaterial> {
  const doc = await getOwnedDocument(userId, documentId);
  if (doc.status !== 'ready') throw new HttpError(409, 'The course is still being processed', 'document_processing');
  uploadLimiter.take(userId);

  // Cheap refusals BEFORE receiving a possibly huge body.
  const hint = kindHint(req.contentType);
  if (hint === 'media' && !transcriber) throw new HttpError(503, 'Lecture uploads are not available yet', 'media_unavailable');
  const maxMb = hint === 'pdf' ? config.MAX_UPLOAD_MB : config.MEDIA_MAX_UPLOAD_MB;
  if (req.contentLength !== null && req.contentLength > maxMb * 1024 * 1024) {
    throw new HttpError(413, `File too large (max ${maxMb} MB)`, 'file_too_large', { maxMb });
  }
  await assertCanUploadMaterial(userId, hint);
  if (!req.body) throw new HttpError(400, 'Send the file as the request body', 'file_missing');

  const id = crypto.randomUUID();
  const fileKey = `${userId}/materials/${id}.upload`; // never executed or served; format checked below
  let stored = false;
  try {
    let size: number;
    try {
      size = await storage.putStream(fileKey, req.body, maxMb * 1024 * 1024);
      stored = true;
    } catch (err) {
      if (err instanceof StorageLimitError) throw new HttpError(413, `File too large (max ${maxMb} MB)`, 'file_too_large', { maxMb });
      throw err;
    }
    if (size === 0) throw new HttpError(400, 'Send the file as the request body', 'file_missing');

    let probe;
    try {
      probe = await probeMedia({ size, read: (start, length) => storage.readRange(fileKey, start, length) });
    } catch (err) {
      if (err instanceof ProbeError) {
        const message =
          err.code === 'media_no_audio'
            ? 'This recording has no audio track'
            : err.code === 'unsupported_format'
              ? 'Unsupported file format'
              : err.code === 'ppt_legacy'
                ? 'Old PowerPoint files (.ppt) are not supported. Save the presentation as .pptx or PDF.'
                : 'This file could not be read';
        throw new HttpError(PROBE_STATUS[err.code], message, err.code);
      }
      throw err;
    }
    if (probe.kind === 'pdf' && size > config.MAX_UPLOAD_MB * 1024 * 1024) {
      throw new HttpError(413, `File too large (max ${config.MAX_UPLOAD_MB} MB)`, 'file_too_large', { maxMb: config.MAX_UPLOAD_MB });
    }
    if (probe.kind !== 'pdf' && !transcriber) throw new HttpError(503, 'Lecture uploads are not available yet', 'media_unavailable');

    let allowance: LectureAllowance | undefined;
    const row = await db.transaction(async (tx) => {
      const reservation = await reserveMaterialUpload(tx, userId, probe.kind, probe.durationSeconds); // locks this user's usage
      allowance = reservation.allowance;
      const [{ n }] = await tx.select({ n: count() }).from(courseMaterials).where(eq(courseMaterials.documentId, doc.id));
      if (n >= MAX_MATERIALS_PER_COURSE) {
        throw new HttpError(409, 'This course already has the maximum number of materials', 'too_many_materials', { max: MAX_MATERIALS_PER_COURSE });
      }
      const [{ active }] = await tx
        .select({ active: count() })
        .from(courseMaterials)
        .where(and(eq(courseMaterials.userId, userId), inArray(courseMaterials.status, [...ACTIVE])));
      if (active >= config.MEDIA_MAX_ACTIVE_PER_USER) {
        throw new HttpError(429, 'Wait for your other materials to finish processing', 'too_many_processing', { max: config.MEDIA_MAX_ACTIVE_PER_USER });
      }
      const [inserted] = await tx
        .insert(courseMaterials)
        .values({
          id,
          documentId: doc.id,
          userId,
          kind: probe.kind,
          format: probe.format,
          title: cleanTitle(req.title),
          fileKey,
          mimeType: req.contentType?.slice(0, 100) || 'application/octet-stream',
          sizeBytes: size,
          durationSeconds: probe.durationSeconds,
          originalDurationSeconds: probe.durationSeconds,
          billedMinutes: reservation.minutes,
          minutesLedgerId: reservation.minutesLedgerId,
          transcriptionProvider: probe.kind === 'pdf' ? null : transcriber!.name,
          aiLanguage: req.language,
        })
        .returning();
      return inserted;
    });

    materialJobs.enqueue(row.id);
    void track('material_processing_started', userId, {
      material_id: row.id,
      document_id: doc.id,
      kind: row.kind,
      format: row.format,
      file_size_kb: Math.round(size / 1024),
      ...(row.durationSeconds ? { duration_s: row.durationSeconds, reserved_minutes: row.billedMinutes } : {}),
      ...(allowance && allowance !== 'none' ? { lecture_allowance: allowance } : {}),
      ...(isPartial(row) ? { partial: true } : {}),
      attempt: 1,
    });
    return toMaterialDto(row);
  } catch (err) {
    if (stored) await storage.delete(fileKey).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------- retry / delete

export async function retryMaterial(userId: string, documentId: string, materialId: string): Promise<CourseMaterial> {
  const m = await getOwnedMaterial(userId, documentId, materialId);
  if (m.status !== 'failed') throw new HttpError(409, 'Only failed materials can be retried', 'material_not_failed');
  if (!canRetry(m)) {
    const code = m.attempts >= MAX_ATTEMPTS ? 'retry_limit' : m.kind !== 'pdf' && m.failedStage !== 'analysis' && !m.fileKey ? 'media_expired' : 'material_not_retryable';
    throw new HttpError(409, 'This material can’t be retried. Remove it and upload it again.', code);
  }
  uploadLimiter.take(userId);
  // A failed transcription released its minutes: reserve them again (402 if the plan has no room).
  const needsTranscription = m.kind !== 'pdf' && m.failedStage !== 'analysis';
  const reservation = needsTranscription ? await reserveMediaMinutes(userId, m.originalDurationSeconds ?? m.durationSeconds ?? 60) : null;
  const [row] = await db
    .update(courseMaterials)
    .set({
      status: m.failedStage === 'analysis' ? 'analyzing' : 'processing',
      errorCode: null,
      attempts: sql`${courseMaterials.attempts} + 1`,
      ...(reservation ? { billedMinutes: reservation.minutes, minutesLedgerId: reservation.minutesLedgerId } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(courseMaterials.id, m.id), eq(courseMaterials.status, 'failed')))
    .returning();
  if (!row) throw new HttpError(409, 'Only failed materials can be retried', 'material_not_failed');
  materialJobs.enqueue(row.id);
  void track('material_processing_started', userId, {
    material_id: row.id,
    document_id: row.documentId,
    kind: row.kind,
    format: row.format,
    file_size_kb: Math.round(row.sizeBytes / 1024),
    ...(row.durationSeconds ? { duration_s: row.durationSeconds } : {}),
    ...(reservation ? { reserved_minutes: reservation.minutes } : {}),
    attempt: row.attempts,
  });
  return toMaterialDto(row);
}

/** Removes a material, its text and the topics only it added. Usage is NOT refunded. */
export async function deleteMaterial(userId: string, documentId: string, materialId: string): Promise<void> {
  const m = await getOwnedMaterial(userId, documentId, materialId);
  materialJobs.cancel(m.id);
  const removed = await db.transaction(async (tx) => {
    await lockCourseTopics(tx, m.documentId);
    await tx.delete(courseMaterials).where(eq(courseMaterials.id, m.id)); // cascades to its chunks
    const before = (await tx.select({ topics: documents.topics }).from(documents).where(eq(documents.id, m.documentId)))[0]?.topics ?? [];
    const after = await recomputeCourseTopics(tx, m.documentId);
    return before.filter((t) => !after.includes(t));
  });
  if (m.fileKey) await storage.delete(m.fileKey).catch(() => {});
  void track('material_deleted', userId, { material_id: m.id, document_id: m.documentId, kind: m.kind, status: m.status });
  if (removed.length) await onCourseTopicsChanged(userId, m.documentId);
}

/** Called before a course is deleted: stop its jobs and return the files to delete afterwards. */
export async function prepareCourseDeletion(documentId: string): Promise<string[]> {
  const rows = await db.select({ id: courseMaterials.id, fileKey: courseMaterials.fileKey }).from(courseMaterials).where(eq(courseMaterials.documentId, documentId));
  rows.forEach((r) => materialJobs.cancel(r.id));
  return rows.map((r) => r.fileKey).filter((k): k is string => !!k);
}

/** Called before an account is deleted: stop that user's jobs (their files go with the user folder). */
export async function cancelUserMaterialJobs(userId: string): Promise<void> {
  const rows = await db.select({ id: courseMaterials.id }).from(courseMaterials).where(eq(courseMaterials.userId, userId));
  rows.forEach((r) => materialJobs.cancel(r.id));
}

// ---------------------------------------------------------------- course topics

/** Serializes topic merges per course (two lectures finishing at once). */
export async function lockCourseTopics(tx: Tx, documentId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`topics:${documentId}`}, 0))`);
}

/** documents.topics = original PDF topics + topics introduced by READY materials (oldest first). */
export async function recomputeCourseTopics(tx: Tx, documentId: string): Promise<string[]> {
  const [doc] = await tx.select({ topics: documents.topics, baseTopics: documents.baseTopics }).from(documents).where(eq(documents.id, documentId));
  if (!doc) return [];
  const mats = await tx
    .select({ newTopics: courseMaterials.newTopics })
    .from(courseMaterials)
    .where(and(eq(courseMaterials.documentId, documentId), eq(courseMaterials.status, 'ready')))
    .orderBy(asc(courseMaterials.createdAt));
  const topics = mergeCourseTopics(doc.baseTopics ?? doc.topics, mats.map((m) => m.newTopics));
  await tx.update(documents).set({ topics }).where(eq(documents.id, documentId));
  return topics;
}

/** Hook for the study planner (wired in ./index.ts to avoid an import cycle). */
let topicsChangedHook: (userId: string, documentId: string) => Promise<void> = async () => {};
export const setTopicsChangedHook = (fn: typeof topicsChangedHook) => (topicsChangedHook = fn);
async function onCourseTopicsChanged(userId: string, documentId: string) {
  await topicsChangedHook(userId, documentId).catch((err) => console.error('[materials] planner update failed', err));
}
