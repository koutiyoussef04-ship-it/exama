/**
 * Organization workspace API, mounted at /orgs. Every route below /orgs/:orgId runs `requireAuth` then
 * `requireOrgRole(min)`: the membership and role are read from the database per request; non-members get 404.
 *
 * Roles: reviewer = read + review (edit/approve/reject) · editor = + upload, generate, create, export, delete ·
 * admin = + members and settings.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  addMemberSchema,
  aiLanguageSchema,
  createBankItemSchema,
  createOrganizationSchema,
  exportQuerySchema,
  generateBankItemsSchema,
  listBankItemsSchema,
  reviewNoteSchema,
  updateBankItemSchema,
  updateMemberSchema,
  updateOrganizationSchema,
  type BankItem,
  type BankItemDetail,
  type BankItemList,
  type DocumentDetail,
  type DocumentSummary,
  type GenerateBankItemsResult,
  type Organization,
  type OrganizationMember,
  type OrganizationMembershipSummary,
  type OrganizationOverview,
  type TopicCount,
} from '@study/shared';
import { eq } from 'drizzle-orm';
import { requireAuth, type AuthEnv } from '../auth/auth.js';
import { requireOrgRole, type OrgEnv } from '../auth/org-access.js';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { HttpError, parseBody } from '../lib/errors.js';
import { RateLimiter } from '../lib/rate-limit.js';
import { exportApproved } from '../services/bank/export.js';
import { generateDraftItems } from '../services/bank/generate.js';
import { approveItem, createManualItem, deleteItem, getItem, listItems, listTopics, rejectItem, reopenItem, retireItem, updateItem } from '../services/bank/service.js';
import { createOrgDocument, deleteOrgDocument, getOrgDocument, listOrgDocuments, orgDocumentDetail, reprocessOrgDocument } from '../services/org-documents.js';
import { addMember, createAdditionalOrganization, getOrganization, getOverview, listMemberships, listMembers, removeMember, updateMemberRole, updateOrganization } from '../services/organizations.js';

/** Generation is the expensive call: per organization member, 20 an hour. */
const generationLimiter = new RateLimiter(20, 60 * 60 * 1000);
/** Creating organizations is rare; bursts are a sign of abuse (each organization has its own allowances). */
const createOrganizationLimiter = new RateLimiter(5, 24 * 60 * 60 * 1000, 'Too many organizations created recently. Please try again tomorrow.');

const org = new Hono<OrgEnv>()
  // ---- organization
  .get('/', requireOrgRole('reviewer'), async (c) => c.json<OrganizationOverview>(await getOverview(c.var.org)))
  .patch('/', requireOrgRole('admin'), async (c) => {
    const input = parseBody(updateOrganizationSchema, await c.req.json().catch(() => ({})));
    return c.json<Organization>(await updateOrganization(c.var.org, input));
  })
  // ---- members (admin)
  .get('/members', requireOrgRole('admin'), async (c) => c.json<OrganizationMember[]>(await listMembers(c.var.org.id)))
  .post('/members', requireOrgRole('admin'), async (c) => {
    const input = parseBody(addMemberSchema, await c.req.json().catch(() => ({})));
    return c.json<OrganizationMember[]>(await addMember(c.var.org, c.var.userId, input), 201);
  })
  .patch('/members/:userId', requireOrgRole('admin'), async (c) => {
    const { role } = parseBody(updateMemberSchema, await c.req.json().catch(() => ({})));
    return c.json<OrganizationMember[]>(await updateMemberRole(c.var.org, c.req.param('userId'), role));
  })
  .delete('/members/:userId', requireOrgRole('admin'), async (c) => c.json<OrganizationMember[]>(await removeMember(c.var.org, c.req.param('userId'))))
  // ---- courses
  .get('/courses', requireOrgRole('reviewer'), async (c) => c.json<DocumentSummary[]>(await listOrgDocuments(c.var.org.id)))
  .post(
    '/courses',
    requireOrgRole('editor'),
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
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : file.name;
      const lang = aiLanguageSchema.safeParse(body.language);
      const doc = await createOrgDocument(c.var.org, c.var.userId, { name: title, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) }, lang.success ? lang.data : 'source');
      return c.json<DocumentDetail>(orgDocumentDetail(doc), 201);
    },
  )
  .get('/courses/:id', requireOrgRole('reviewer'), async (c) => c.json<DocumentDetail>(orgDocumentDetail(await getOrgDocument(c.var.org.id, c.req.param('id')))))
  .post('/courses/:id/reprocess', requireOrgRole('editor'), async (c) => c.json<DocumentDetail>(orgDocumentDetail(await reprocessOrgDocument(c.var.org.id, c.req.param('id')))))
  .delete('/courses/:id', requireOrgRole('editor'), async (c) => {
    await deleteOrgDocument(c.var.org, c.var.userId, c.req.param('id'));
    return c.body(null, 204);
  })
  // ---- generation (AI): drafts with located sources; never approved
  .post('/courses/:id/generate', requireOrgRole('editor'), async (c) => {
    generationLimiter.take(`${c.var.org.id}:${c.var.userId}`);
    const input = parseBody(generateBankItemsSchema, await c.req.json().catch(() => ({})));
    return c.json<GenerateBankItemsResult>(await generateDraftItems(c.var.org, c.var.userId, c.req.param('id'), input), 201);
  })
  // ---- question bank
  .get('/items', requireOrgRole('reviewer'), async (c) => {
    const q = parseBody(listBankItemsSchema, c.req.query());
    return c.json<BankItemList>(await listItems(c.var.org.id, q));
  })
  .post('/items', requireOrgRole('editor'), async (c) => {
    const input = parseBody(createBankItemSchema, await c.req.json().catch(() => ({})));
    return c.json<BankItem>(await createManualItem(c.var.org, c.var.userId, input), 201);
  })
  .get('/topics', requireOrgRole('reviewer'), async (c) => c.json<TopicCount[]>(await listTopics(c.var.org.id, c.req.query('documentId') || undefined)))
  .get('/items/:id', requireOrgRole('reviewer'), async (c) => c.json<BankItemDetail>(await getItem(c.var.org.id, c.req.param('id'))))
  .patch('/items/:id', requireOrgRole('reviewer'), async (c) => {
    const input = parseBody(updateBankItemSchema, await c.req.json().catch(() => ({})));
    return c.json<BankItemDetail>(await updateItem(c.var.org, c.var.userId, c.req.param('id'), input));
  })
  .post('/items/:id/approve', requireOrgRole('reviewer'), async (c) => {
    const { note } = parseBody(reviewNoteSchema, await c.req.json().catch(() => ({})));
    return c.json<BankItemDetail>(await approveItem(c.var.org, c.var.userId, c.req.param('id'), note));
  })
  .post('/items/:id/reject', requireOrgRole('reviewer'), async (c) => {
    const { note } = parseBody(reviewNoteSchema, await c.req.json().catch(() => ({})));
    return c.json<BankItemDetail>(await rejectItem(c.var.org, c.var.userId, c.req.param('id'), note));
  })
  .post('/items/:id/retire', requireOrgRole('editor'), async (c) => {
    const { note } = parseBody(reviewNoteSchema, await c.req.json().catch(() => ({})));
    return c.json<BankItemDetail>(await retireItem(c.var.org, c.var.userId, c.req.param('id'), note));
  })
  .post('/items/:id/reopen', requireOrgRole('reviewer'), async (c) => {
    const { note } = parseBody(reviewNoteSchema, await c.req.json().catch(() => ({})));
    return c.json<BankItemDetail>(await reopenItem(c.var.org, c.var.userId, c.req.param('id'), note));
  })
  .delete('/items/:id', requireOrgRole('editor'), async (c) => {
    await deleteItem(c.var.org, c.req.param('id'));
    return c.body(null, 204);
  })
  // ---- export (approved items only)
  .get('/export', requireOrgRole('editor'), async (c) => {
    const q = parseBody(exportQuerySchema, c.req.query());
    const file = await exportApproved(c.var.org.id, q.format, q);
    c.header('Content-Type', file.contentType);
    c.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    c.header('X-Exama-Export-Count', String(file.count));
    return c.body(file.body);
  });

export const orgRoutes = new Hono<AuthEnv>()
  .use(requireAuth)
  /** The caller's organizations (same as GET /auth/me → organizations). */
  .get('/', async (c) => c.json<OrganizationMembershipSummary[]>(await listMemberships(c.var.userId)))
  /**
   * Creates an organization with the caller as admin. Only organization accounts (the sign-up choice) can
   * create organizations; student accounts join when an admin adds them. Capped per account
   * (MAX_ORGANIZATIONS_PER_ACCOUNT, sign-up organization included) and rate limited.
   */
  .post('/', async (c) => {
    const input = parseBody(createOrganizationSchema, await c.req.json().catch(() => ({})));
    const [user] = await db.select({ accountType: users.accountType }).from(users).where(eq(users.id, c.var.userId));
    if (user?.accountType !== 'organization') throw new HttpError(403, 'Only organization accounts can create organizations', 'organization_account_required');
    createOrganizationLimiter.take(c.var.userId);
    const created = await createAdditionalOrganization(c.var.userId, input);
    return c.json<OrganizationMembershipSummary>({ id: created.id, name: created.name, market: created.market, role: 'admin' }, 201);
  })
  .route('/:orgId', org);
