import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { courseMaterials, documentChunks } from '../db/schema.js';

/**
 * Course text that AI features may use: the original PDF plus materials that finished processing.
 * (A lecture whose knowledge extraction failed keeps its transcript for the retry, but isn't used yet.)
 */
export const usableChunks = (documentId: string) =>
  and(
    eq(documentChunks.documentId, documentId),
    or(
      isNull(documentChunks.materialId),
      inArray(
        documentChunks.materialId,
        db.select({ id: courseMaterials.id }).from(courseMaterials).where(and(eq(courseMaterials.documentId, documentId), eq(courseMaterials.status, 'ready'))),
      ),
    ),
  );
