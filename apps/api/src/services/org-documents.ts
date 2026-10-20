/**
 * Organization courses: the same upload → extract → chunk → analyze pipeline as a student's course
 * (services/documents.ts), owned by the organization instead of a person. Every lookup carries the
 * organization id in the WHERE clause; another organization's course answers 404.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { AiLanguage, DocumentDetail, DocumentSummary } from '@study/shared';
import { track } from '../analytics/index.js';
import { reserveOrgCourseUpload, resolveOrgLimits } from '../billing/org-limits.js';
import type { OrgContext } from '../auth/org-access.js';
import { db } from '../db/client.js';
import { documents, organizations } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { storage } from '../storage/index.js';
import { createDocument, processDocument, toDetail, toSummary } from './documents.js';
import { prepareCourseDeletion } from './materials/index.js';

type DocumentRow = typeof documents.$inferSelect;

export async function listOrgDocuments(orgId: string): Promise<DocumentSummary[]> {
  const rows = await db.select().from(documents).where(eq(documents.organizationId, orgId)).orderBy(desc(documents.createdAt));
  return rows.map(toSummary);
}

/** A course of this organization, or 404. */
export async function getOrgDocument(orgId: string, id: string): Promise<DocumentRow> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, orgId)));
  if (!doc) throw new HttpError(404, 'Course not found', 'not_found');
  return doc;
}

export const orgDocumentDetail = (doc: DocumentRow): DocumentDetail => toDetail(doc);

export async function createOrgDocument(org: OrgContext, actorUserId: string, file: { name: string; type: string; bytes: Uint8Array }, aiLanguage: AiLanguage) {
  const [row] = await db.select({ limits: organizations.limits }).from(organizations).where(eq(organizations.id, org.id));
  const limits = resolveOrgLimits(row?.limits);
  const doc = await createDocument(actorUserId, file, {
    organizationId: org.id,
    aiLanguage,
    reserve: (tx) => reserveOrgCourseUpload(tx, org.id, actorUserId, limits),
  });
  void track('upload_succeeded', actorUserId, { document_id: doc.id, file_size_kb: Math.round(doc.sizeBytes / 1024), ai_language: aiLanguage });
  return doc;
}

export async function reprocessOrgDocument(orgId: string, id: string) {
  const doc = await getOrgDocument(orgId, id);
  if (doc.status !== 'failed') throw new HttpError(409, 'Only failed courses can be retried', 'document_not_failed');
  const [updated] = await db
    .update(documents)
    .set({ status: 'processing', error: null, errorCode: null })
    .where(and(eq(documents.id, doc.id), eq(documents.organizationId, orgId)))
    .returning();
  void processDocument(doc.id);
  return updated ?? doc;
}

/** Deletes the course, its materials, chunks, bank items and files (organization usage is not refunded). */
export async function deleteOrgDocument(org: OrgContext, actorUserId: string, id: string) {
  const doc = await getOrgDocument(org.id, id);
  const materialFiles = await prepareCourseDeletion(doc.id);
  await db.delete(documents).where(and(eq(documents.id, doc.id), eq(documents.organizationId, org.id))); // cascades to materials, chunks, bank items, sources
  await Promise.all([doc.fileKey, ...materialFiles].map((k) => storage.delete(k).catch((err) => console.error(`[org-documents] could not delete ${k}:`, err))));
  void track('course_deleted', actorUserId, { document_id: doc.id });
}
