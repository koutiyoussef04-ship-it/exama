/**
 * Processing pipeline for one course material:
 *
 *   audio/video:  processing → transcribing → (transcript saved as timestamped chunks, raw media
 *                 deleted, minutes settled to the real length) → analyzing → ready
 *   pdf/pptx:     processing → analyzing (text + knowledge saved together) → ready
 *
 * Failures are recorded with a stable errorCode and the stage, so a retry resumes where it stopped
 * (a lecture whose AI step failed is never transcribed — or charged — twice). Every write checks that
 * the material still exists: deleting the material or its course mid-way stops the job cleanly.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { MaterialKnowledge } from '@study/shared';
import { AIError, studyAI } from '../../ai/index.js';
import { resolveOutputLanguage } from '../../ai/language.js';
import { track } from '../../analytics/index.js';
import { releaseMediaMinutes, settleMediaMinutes } from '../../billing/entitlements.js';
import { config } from '../../config.js';
import { db } from '../../db/client.js';
import { courseMaterials, documentChunks, documents } from '../../db/schema.js';
import { sanitizeKnowledge, type SourceSegment } from '../../lib/knowledge.js';
import { extractDocumentPages } from '../../lib/document-text.js';
import { chunkPages } from '../../lib/pdf.js';
import { storage } from '../../storage/index.js';
import { transcriber, TranscriptionError, type TranscriptSegment } from '../../transcription/index.js';
import { lockCourseTopics, recomputeCourseTopics, type MaterialRow } from './service.js';

/** A failure the student can act on (the code is translated by the apps). */
class MaterialFailure extends Error {
  constructor(public code: string) {
    super(code);
  }
}
/** The material (or its course) was deleted while processing: stop quietly. */
class Gone extends Error {}

const TRANSCRIPT_CHUNK_CHARS = 3000;

/** Groups timestamped paragraphs into ~page-sized chunks (the unit exams and the planner read). */
export function segmentsToChunks(segments: TranscriptSegment[], maxChars = TRANSCRIPT_CHUNK_CHARS) {
  const out: { content: string; startSeconds: number; endSeconds: number }[] = [];
  let cur: TranscriptSegment[] = [];
  let len = 0;
  const flush = () => {
    if (!cur.length) return;
    out.push({
      content: cur.map((s) => s.text).join(' '),
      startSeconds: Math.floor(cur[0].startMs / 1000),
      endSeconds: Math.ceil(cur[cur.length - 1].endMs / 1000),
    });
    cur = [];
    len = 0;
  };
  for (const seg of segments) {
    const text = seg.text.replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (len && len + text.length > maxChars) flush();
    cur.push({ ...seg, text });
    len += text.length + 1;
  }
  flush();
  return out;
}

async function load(id: string): Promise<MaterialRow> {
  const [m] = await db.select().from(courseMaterials).where(eq(courseMaterials.id, id));
  if (!m) throw new Gone();
  return m;
}

/** Updates the material; throws Gone if it no longer exists. */
async function update(id: string, values: Partial<typeof courseMaterials.$inferInsert>): Promise<MaterialRow> {
  const [m] = await db
    .update(courseMaterials)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(courseMaterials.id, id))
    .returning();
  if (!m) throw new Gone();
  return m;
}

const nextPosition = async (documentId: string, exec: Pick<typeof db, 'select'> = db) =>
  ((
    await exec
      .select({ max: sql<number | null>`max(${documentChunks.position})` })
      .from(documentChunks)
      .where(eq(documentChunks.documentId, documentId))
  )[0]?.max ?? -1) + 1;

function transcriptionTimeoutMs(m: MaterialRow) {
  if (config.MEDIA_TRANSCRIPTION_TIMEOUT_SECONDS) return config.MEDIA_TRANSCRIPTION_TIMEOUT_SECONDS * 1000;
  return (600 + (m.durationSeconds ?? 3600) * 0.5) * 1000;
}

// ---------------------------------------------------------------- stages

async function transcribe(m: MaterialRow, signal: AbortSignal): Promise<MaterialRow> {
  if (!transcriber) throw new TranscriptionError('not_configured', 'transcription disabled');
  if (!m.fileKey) throw new MaterialFailure('media_expired');
  m = await update(m.id, { status: 'transcribing' });
  const started = Date.now();
  const key = m.fileKey!;
  const maxSeconds = Math.max(60, m.billedMinutes * 60);
  const transcript = await transcriber.transcribe({
    media: {
      size: m.sizeBytes,
      mimeType: m.mimeType,
      open: () => storage.readStream(key),
      peek: () => storage.readRange(key, 0, 64 * 1024),
    },
    expectedSeconds: m.durationSeconds ?? maxSeconds,
    maxSeconds,
    signal: AbortSignal.any([signal, AbortSignal.timeout(transcriptionTimeoutMs(m))]),
  });
  const chunks = segmentsToChunks(transcript.segments);
  if (!chunks.length) throw new TranscriptionError('no_speech', 'no text');

  // Save the transcript, settle the minutes to what was really transcribed, drop the raw media.
  const billed = m.minutesLedgerId ? await settleMediaMinutes(m.minutesLedgerId, m.billedMinutes, transcript.durationSeconds) : m.billedMinutes;
  const saved = await db.transaction(async (tx) => {
    const [still] = await tx.select({ id: courseMaterials.id }).from(courseMaterials).where(eq(courseMaterials.id, m.id)).for('update');
    if (!still) return null;
    const start = await nextPosition(m.documentId, tx);
    await tx.delete(documentChunks).where(eq(documentChunks.materialId, m.id));
    await tx.insert(documentChunks).values(
      chunks.map((c, i) => ({ documentId: m.documentId, materialId: m.id, position: start + i, pageStart: 0, pageEnd: 0, content: c.content, startSeconds: c.startSeconds, endSeconds: c.endSeconds })),
    );
    const [row] = await tx
      .update(courseMaterials)
      .set({
        status: 'analyzing',
        durationSeconds: transcript.durationSeconds,
        billedMinutes: billed,
        sourceLanguage: transcript.language,
        fileKey: null,
        mediaDeletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(courseMaterials.id, m.id))
      .returning();
    return row;
  });
  if (!saved) throw new Gone();
  await storage.delete(key).catch((err) => console.error(`[materials] could not delete media of ${m.id}:`, err));
  void track('material_transcription_completed', m.userId, {
    material_id: m.id,
    document_id: m.documentId,
    kind: m.kind,
    success: true,
    provider: transcriber.name,
    transcription_ms: Date.now() - started,
    duration_s: transcript.durationSeconds,
    billed_minutes: billed,
    ...(transcript.language ? { source_language: transcript.language } : {}),
  });
  return saved;
}

/** PDF/PowerPoint text as chunks (kept in memory until the analysis succeeds — the file stays in storage). */
async function readPdf(m: MaterialRow) {
  const format = m.format === 'pptx' ? 'pptx' : 'pdf';
  if (!m.fileKey) throw new MaterialFailure(`${format}_unreadable`);
  let pages: string[];
  try {
    pages = await extractDocumentPages(await storage.get(m.fileKey), format);
  } catch {
    throw new MaterialFailure(`${format}_unreadable`);
  }
  const chunks = chunkPages(pages);
  if (!chunks.length) throw new MaterialFailure(`${format}_no_text`);
  return { pages: pages.length, chunks };
}

async function analyze(m: MaterialRow, pdf: Awaited<ReturnType<typeof readPdf>> | null): Promise<MaterialRow> {
  m = await update(m.id, { status: 'analyzing' });
  const [doc] = await db.select().from(documents).where(eq(documents.id, m.documentId));
  if (!doc) throw new Gone();

  const segments: SourceSegment[] = pdf
    ? pdf.chunks.map((c) => ({ text: c.content, startSeconds: null, page: c.pageStart }))
    : (
        await db
          .select({ content: documentChunks.content, startSeconds: documentChunks.startSeconds })
          .from(documentChunks)
          .where(eq(documentChunks.materialId, m.id))
          .orderBy(asc(documentChunks.position))
      ).map((c) => ({ text: c.content, startSeconds: c.startSeconds, page: null }));
  if (!segments.length) throw new MaterialFailure(pdf ? (m.format === 'pptx' ? 'pptx_no_text' : 'pdf_no_text') : 'media_no_speech');

  const text = segments.map((s) => s.text).join('\n\n');
  const source = m.sourceLanguage ?? null;
  const language = resolveOutputLanguage(m.aiLanguage, source, doc.summaryLanguage ?? 'en');
  const raw = await studyAI.extractKnowledge({
    text,
    kind: m.kind,
    existingTopics: doc.topics,
    topicLanguage: doc.summaryLanguage ?? language,
    language: m.aiLanguage === 'source' ? 'source' : language,
  });
  const { summary, topics, rejected } = sanitizeKnowledge(raw, { existingTopics: doc.topics, segments });
  if (rejected) console.warn(`[materials] ${m.id}: dropped ${rejected} ungrounded/duplicate topic(s)`);
  if (!topics.length) throw new MaterialFailure('material_no_topics');

  const knowledge: MaterialKnowledge = { summary, topics, basis: pdf ? 'text' : 'transcript' };
  const done = await db.transaction(async (tx) => {
    await lockCourseTopics(tx, m.documentId);
    const [still] = await tx.select({ id: courseMaterials.id }).from(courseMaterials).where(eq(courseMaterials.id, m.id));
    if (!still) return null;
    const [fresh] = await tx.select({ topics: documents.topics }).from(documents).where(eq(documents.id, m.documentId));
    const known = new Set((fresh?.topics ?? []).map((t) => t.toLowerCase()));
    const newTopics = topics.filter((t) => t.isNew && !known.has(t.name.toLowerCase())).map((t) => t.name);
    if (pdf) {
      const start = await nextPosition(m.documentId, tx);
      await tx.insert(documentChunks).values(pdf.chunks.map((c, i) => ({ ...c, position: start + i, documentId: m.documentId, materialId: m.id })));
    }
    const [row] = await tx
      .update(courseMaterials)
      .set({
        status: 'ready',
        errorCode: null,
        failedStage: null,
        summary,
        knowledge,
        topics: topics.map((t) => t.name),
        newTopics,
        language: m.aiLanguage === 'source' ? (raw.sourceLanguage ?? source ?? language) : language,
        sourceLanguage: source ?? raw.sourceLanguage,
        ...(pdf ? { pageCount: pdf.pages } : {}),
        processedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(courseMaterials.id, m.id))
      .returning();
    await recomputeCourseTopics(tx, m.documentId);
    return row;
  });
  if (!done) throw new Gone();
  return done;
}

// ---------------------------------------------------------------- job

function failureCode(err: unknown): string {
  if (err instanceof MaterialFailure) return err.code;
  if (err instanceof TranscriptionError) {
    if (err.code === 'no_speech') return 'media_no_speech';
    if (err.code === 'unsupported_media') return 'media_unreadable';
    if (err.code === 'timeout') return 'transcription_timeout';
    return 'transcription_failed';
  }
  if (err instanceof AIError) return `ai_${err.code}`;
  return 'processing_failed';
}

export async function processMaterial(id: string, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  let m: MaterialRow;
  try {
    m = await load(id);
  } catch {
    return;
  }
  if (m.status === 'ready' || m.status === 'failed') return;
  let stage: 'transcription' | 'analysis' = m.kind !== 'pdf' && m.status !== 'analyzing' ? 'transcription' : 'analysis';
  try {
    let pdf = null;
    if (m.kind === 'pdf') pdf = await readPdf(m);
    else if (stage === 'transcription') m = await transcribe(m, signal);
    stage = 'analysis';
    if (signal.aborted) throw new Gone();
    m = await analyze(m, pdf);
    void track('material_processing_completed', m.userId, {
      material_id: m.id,
      document_id: m.documentId,
      kind: m.kind,
      processing_ms: Date.now() - started,
      topic_count: m.topics.length,
      new_topic_count: m.newTopics.length,
      chunk_count: (await db.select({ id: documentChunks.id }).from(documentChunks).where(eq(documentChunks.materialId, m.id))).length,
      ...(m.durationSeconds ? { duration_s: m.durationSeconds } : {}),
      ...(m.pageCount ? { page_count: m.pageCount } : {}),
      language: m.language ?? 'en',
    });
  } catch (err) {
    // Cancelled (the material or its course is being deleted) or already gone: nothing to record.
    if (err instanceof Gone || signal.aborted) return;
    const current = await db.select().from(courseMaterials).where(eq(courseMaterials.id, id)).then((r) => r[0]);
    if (!current) return;
    const code = failureCode(err);
    const detail = err instanceof TranscriptionError ? `${err.code}: ${err.detail}` : err instanceof AIError ? `${err.code}: ${err.detail}` : err;
    console.error(`[materials] ${id} failed at ${stage}:`, detail);
    const releaseMinutes = stage === 'transcription' && current.minutesLedgerId;
    if (releaseMinutes) await releaseMediaMinutes(current.minutesLedgerId!);
    await db
      .update(courseMaterials)
      .set({
        status: 'failed',
        failedStage: stage,
        errorCode: code,
        ...(releaseMinutes ? { billedMinutes: 0, minutesLedgerId: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(courseMaterials.id, id)));
    const props = { material_id: id, document_id: current.documentId, kind: current.kind };
    if (stage === 'transcription') {
      void track('material_transcription_completed', current.userId, {
        ...props,
        success: false,
        provider: transcriber?.name ?? 'none',
        transcription_ms: Date.now() - started,
        failure_reason: code,
      });
    }
    void track('material_processing_failed', current.userId, { ...props, stage, failure_reason: code, attempt: current.attempts });
  }
}


