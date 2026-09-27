import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { aiLanguageSchema, createExamSchema } from '@study/shared';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { track } from '../analytics/index.js';
import { assertCanAddCourse, reserveCourseUpload } from '../billing/entitlements.js';
import { config } from '../config.js';
import { HttpError, parseBody } from '../lib/errors.js';
import { createDocument, deleteDocument, getOwnedDocument, listDocuments, reprocessDocument, toDetail } from '../services/documents.js';
import { createExam } from '../services/exams.js';
import { getProgress } from '../services/progress.js';

export const documentRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  .get('/', async (c) => c.json(await listDocuments(c.var.userId)))
  .post(
    '/',
    bodyLimit({
      maxSize: config.MAX_UPLOAD_MB * 1024 * 1024,
      onError: () => {
        throw new HttpError(413, `File too large (max ${config.MAX_UPLOAD_MB} MB)`, 'file_too_large', { maxMb: config.MAX_UPLOAD_MB });
      },
    }),
    async (c) => {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) throw new HttpError(400, 'Attach a PDF or PowerPoint (.pptx) as the "file" field', 'file_missing');
      // Quick 402 before reading the file; the authoritative check + reservation happens with the insert below.
      await assertCanAddCourse(c.var.userId);
      // Optional "title" field: mobile uploads send the original file name here, because the
      // picked file itself has a generated cache name.
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : file.name;
      // Optional "language" field: the student's AI/study language (en/es/fr/ar, or "source").
      const lang = aiLanguageSchema.safeParse(body.language);
      const aiLanguage = lang.success ? lang.data : 'en';
      const doc = await createDocument(
        c.var.userId,
        { name: title, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) },
        { reserve: (tx) => reserveCourseUpload(tx, c.var.userId), aiLanguage },
      );
      void track('upload_succeeded', c.var.userId, { document_id: doc.id, file_size_kb: Math.round(doc.sizeBytes / 1024), ai_language: aiLanguage });
      return c.json(toDetail(doc), 201);
    },
  )
  .get('/:id', async (c) => c.json(toDetail(await getOwnedDocument(c.var.userId, c.req.param('id')))))
  .delete('/:id', async (c) => {
    await deleteDocument(c.var.userId, c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/:id/reprocess', async (c) => c.json(toDetail(await reprocessDocument(c.var.userId, c.req.param('id')))))
  .get('/:id/progress', async (c) => {
    const doc = await getOwnedDocument(c.var.userId, c.req.param('id'));
    return c.json(await getProgress(c.var.userId, doc.id));
  })
  .post('/:id/exams', async (c) => {
    const input = parseBody(createExamSchema, await c.req.json().catch(() => ({})));
    return c.json(await createExam(c.var.userId, c.req.param('id'), input), 201);
  });
