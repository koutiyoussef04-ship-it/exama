import { and, desc, eq, isNull } from 'drizzle-orm';
import type { AiLanguage, DocumentDetail, DocumentSummary } from '@study/shared';
import { AIError, studyAI } from '../ai/index.js';
import { track } from '../analytics/index.js';
import { db } from '../db/client.js';
import { documentChunks, documents } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { detectDocumentFormat, extractDocumentPages, formatForMime, MIME_BY_FORMAT, noTextError } from '../lib/document-text.js';
import { chunkPages } from '../lib/pdf.js';
import { storage } from '../storage/index.js';
import { resolveOutputLanguage } from '../ai/language.js';

type DocumentRow = typeof documents.$inferSelect;

export const toSummary = (d: DocumentRow): DocumentSummary => ({
  id: d.id,
  title: d.title,
  status: d.status,
  format: formatForMime(d.mimeType),
  pageCount: d.pageCount,
  createdAt: d.createdAt.toISOString(),
});

export const toDetail = (d: DocumentRow): DocumentDetail => ({
  ...toSummary(d),
  summary: d.summary,
  topics: d.topics,
  error: d.error,
  errorCode: d.errorCode,
  summaryLanguage: d.summaryLanguage,
  sourceLanguage: d.sourceLanguage,
});

export async function listDocuments(userId: string) {
  const rows = await db.select().from(documents).where(eq(documents.userId, userId)).orderBy(desc(documents.createdAt));
  return rows.map(toSummary);
}

export async function getOwnedDocument(userId: string, id: string): Promise<DocumentRow> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.userId, userId)));
  if (!doc) throw new HttpError(404, 'Document not found', 'not_found');
  return doc;
}

type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/**
 * Stores the PDF / PowerPoint and creates the course. `reserve` runs in the same transaction as the insert
 * (plan check + usage reservation), so a refused or failed upload leaves no course and no usage.
 */
export async function createDocument(
  userId: string,
  file: { name: string; type: string; bytes: Uint8Array },
  opts: { reserve?: (tx: Tx) => Promise<void>; aiLanguage?: AiLanguage } = {},
) {
  const format = await detectDocumentFormat(file.bytes);

  const id = crypto.randomUUID();
  const fileKey = `${userId}/${id}.${format}`;
  await storage.put(fileKey, file.bytes);
  let doc: DocumentRow;
  try {
    doc = await db.transaction(async (tx) => {
      await opts.reserve?.(tx);
      const [row] = await tx
        .insert(documents)
        .values({
          id,
          userId,
          title: file.name.replace(/\.(pdf|pptx)$/i, '') || 'Untitled',
          fileKey,
          mimeType: MIME_BY_FORMAT[format],
          sizeBytes: file.bytes.byteLength,
          aiLanguage: opts.aiLanguage ?? 'en',
        })
        .returning();
      return row;
    });
  } catch (err) {
    await storage.delete(fileKey).catch(() => {});
    throw err;
  }

  // Fire-and-forget for the MVP. Move to a job queue (e.g. pg-boss) when volume grows.
  void processDocument(doc.id);
  return doc;
}

/** Extract text → chunk → AI analysis (summary + topics). */
export async function processDocument(documentId: string) {
  const startedAt = Date.now();
  let userId: string | null = null;
  try {
    const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
    if (!doc) return;
    userId = doc.userId;
    const format = formatForMime(doc.mimeType);
    const pages = await extractDocumentPages(await storage.get(doc.fileKey), format);
    const chunks = chunkPages(pages);
    if (chunks.length === 0) throw noTextError(format);
    const analysis = await studyAI.analyzeDocument(chunks.map((c) => c.content).join('\n\n'), { language: doc.aiLanguage });
    const summaryLanguage = resolveOutputLanguage(doc.aiLanguage, analysis.sourceLanguage);

    await db.transaction(async (tx) => {
      // Only the original PDF's text: chunks of added materials (material_id set) are kept.
      await tx.delete(documentChunks).where(and(eq(documentChunks.documentId, documentId), isNull(documentChunks.materialId)));
      await tx.insert(documentChunks).values(chunks.map((c) => ({ ...c, documentId })));
      await tx
        .update(documents)
        .set({
          status: 'ready',
          pageCount: pages.length,
          summary: analysis.summary,
          topics: analysis.topics,
          baseTopics: analysis.topics,
          summaryLanguage,
          sourceLanguage: analysis.sourceLanguage,
          error: null,
          errorCode: null,
        })
        .where(eq(documents.id, documentId));
    });
    void track('document_processing_completed', doc.userId, {
      document_id: documentId,
      success: true,
      duration_ms: Date.now() - startedAt,
      page_count: pages.length,
      topic_count: analysis.topics.length,
      summary_language: summaryLanguage,
      ...(analysis.sourceLanguage ? { source_language: analysis.sourceLanguage } : {}),
    });
  } catch (err) {
    // Only user-safe messages are stored (they are shown in the app); details go to the server log.
    const message = err instanceof AIError || err instanceof HttpError ? err.message : 'Processing failed. Please try again.';
    console.error(`[documents] processing ${documentId} failed:`, err instanceof AIError ? `${err.code}: ${err.detail}` : err);
    const errorCode = processingFailureCode(err);
    await db.update(documents).set({ status: 'failed', error: message, errorCode }).where(eq(documents.id, documentId));
    void track('document_processing_completed', userId, {
      document_id: documentId,
      success: false,
      duration_ms: Date.now() - startedAt,
      failure_reason: processingFailureReason(err),
    });
  }
}

/** Stable code the apps translate (the stored message is the English fallback). */
function processingFailureCode(err: unknown): string {
  if (err instanceof AIError) return `ai_${err.code}`;
  if (err instanceof HttpError && err.code) return err.code;
  return 'processing_failed';
}

/** Coarse category only — never the message text. */
function processingFailureReason(err: unknown): string {
  if (err instanceof AIError) return `ai_${err.code}`;
  if (err instanceof HttpError && err.status === 422) return err.message.startsWith('No text') ? 'no_text' : err.code === 'pptx_unreadable' ? 'unreadable_pptx' : 'unreadable_pdf';
  return 'other';
}

/** Retry a failed document (e.g. after an AI outage) without re-uploading. */
export async function reprocessDocument(userId: string, id: string) {
  const doc = await getOwnedDocument(userId, id);
  if (doc.status !== 'failed') throw new HttpError(409, 'Only failed documents can be retried', 'document_not_failed');
  const [updated] = await db
    .update(documents)
    .set({ status: 'processing', error: null, errorCode: null })
    .where(eq(documents.id, doc.id))
    .returning();
  void processDocument(doc.id);
  return updated;
}

/** Re-run documents left in "processing" by a server restart. */
export async function resumePendingDocuments() {
  const pending = await db.select({ id: documents.id }).from(documents).where(eq(documents.status, 'processing'));
  for (const { id } of pending) void processDocument(id);
}

/** Deletes the course and everything in it: materials (jobs stopped first), chunks, exams, plan, files. */
export async function deleteDocument(userId: string, id: string) {
  const doc = await getOwnedDocument(userId, id);
  const materialFiles = await beforeCourseDeletion(doc.id);
  await db.delete(documents).where(eq(documents.id, doc.id)); // cascades to materials, chunks, exams, plan
  await Promise.all([doc.fileKey, ...materialFiles].map((k) => storage.delete(k).catch((err) => console.error(`[documents] could not delete ${k}:`, err))));
  void track('course_deleted', userId, { document_id: doc.id });
}

/** Set by the materials module (stops processing jobs, returns their files). Avoids an import cycle. */
let beforeCourseDeletion: (documentId: string) => Promise<string[]> = async () => [];
export const setBeforeCourseDeletion = (fn: typeof beforeCourseDeletion) => (beforeCourseDeletion = fn);
