import { Hono } from 'hono';
import { MATERIAL_HEADERS, materialLanguageSchema } from '@study/shared';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { createMaterial, deleteMaterial, getMaterial, listMaterials, retryMaterial } from '../services/materials/index.js';

/**
 * Course materials, under the course: /documents/:id/materials…
 * Upload = the raw file as the request body (streamed to disk), metadata in headers — see
 * packages/shared/src/materials.ts. Every route checks sign-in and course ownership.
 */
export const materialRoutes = new Hono<AuthEnv>()
  .use('/:id/materials', requireAuth)
  .use('/:id/materials/*', requireAuth)
  .get('/:id/materials', async (c) => c.json(await listMaterials(c.var.userId, c.req.param('id'))))
  .post('/:id/materials', async (c) => {
    const length = Number(c.req.header('content-length'));
    const lang = materialLanguageSchema.safeParse(c.req.header(MATERIAL_HEADERS.language));
    const material = await createMaterial(c.var.userId, c.req.param('id'), {
      body: c.req.raw.body,
      contentType: c.req.header('content-type') ?? null,
      contentLength: Number.isFinite(length) && length > 0 ? length : null,
      title: c.req.header(MATERIAL_HEADERS.title) ?? null,
      language: lang.success ? lang.data : 'en',
    });
    return c.json(material, 201);
  })
  .get('/:id/materials/:materialId', async (c) => c.json(await getMaterial(c.var.userId, c.req.param('id'), c.req.param('materialId'))))
  .post('/:id/materials/:materialId/retry', async (c) => c.json(await retryMaterial(c.var.userId, c.req.param('id'), c.req.param('materialId'))))
  .delete('/:id/materials/:materialId', async (c) => {
    await deleteMaterial(c.var.userId, c.req.param('id'), c.req.param('materialId'));
    return c.body(null, 204);
  });
