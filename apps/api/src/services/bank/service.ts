/**
 * Question bank: reading, editing and reviewing items. Every query is scoped to the organization; an item
 * of another organization answers 404. Rules:
 * - nothing is approved by the system: `approve` is a person's action, recorded with who and when;
 * - an edit creates a new version (snapshot in bank_item_revisions) and sends the item back to draft;
 * - every action writes a bank_item_events row (the audit history shown on the item).
 */
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BankItem, BankItemDetail, BankItemEvent, BankItemList, BankItemStatus, CreateBankItemInput, TopicCount, UpdateBankItemInput } from '@study/shared';
import { legalRefSchema } from '@study/shared';
import type { OrgContext } from '../../auth/org-access.js';
import { db } from '../../db/client.js';
import { bankItemEvents, bankItemRevisions, bankItems, documents, questionSources, users } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { getOrgDocument } from '../org-documents.js';

type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];
type ItemRow = typeof bankItems.$inferSelect;
type SourceRow = typeof questionSources.$inferSelect;

const toSource = (s: SourceRow): BankItem['sources'][number] => ({
  id: s.id,
  documentId: s.documentId,
  materialId: s.materialId,
  chunkId: s.chunkId,
  chunkHash: s.chunkHash,
  pageStart: s.pageStart,
  pageEnd: s.pageEnd,
  startSeconds: s.startSeconds,
  endSeconds: s.endSeconds,
  quote: s.quote,
  quoteStart: s.quoteStart,
  quoteEnd: s.quoteEnd,
  matchScore: s.matchScore,
  located: s.located,
});

export const toBankItem = (r: ItemRow, documentTitle: string, sources: SourceRow[]): BankItem => ({
  id: r.id,
  organizationId: r.organizationId,
  documentId: r.documentId,
  documentTitle,
  type: r.type,
  topic: r.topic,
  section: r.section,
  stem: r.stem,
  options: r.options ?? null,
  correctAnswer: r.correctAnswer,
  explanation: r.explanation,
  difficulty: r.difficulty ?? null,
  status: r.status,
  version: r.version,
  origin: r.origin,
  reviewFlags: r.reviewFlags,
  verification: r.verification ?? null,
  legalRef: r.legalRef ?? null,
  createdBy: r.createdBy,
  reviewedBy: r.reviewedBy,
  reviewedAt: r.reviewedAt?.toISOString() ?? null,
  reviewNote: r.reviewNote,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  sources: sources.map(toSource),
});

/** The snapshot kept per version: everything a reviewer approved. */
export const snapshotOf = (r: Pick<ItemRow, 'stem' | 'options' | 'correctAnswer' | 'explanation' | 'topic' | 'section' | 'difficulty' | 'legalRef' | 'type'>) => ({
  type: r.type,
  topic: r.topic,
  section: r.section ?? null,
  stem: r.stem,
  options: r.options ?? null,
  correctAnswer: r.correctAnswer,
  explanation: r.explanation,
  difficulty: r.difficulty ?? null,
  legalRef: r.legalRef ?? null,
});

export async function recordEvent(tx: Tx | typeof db, item: Pick<ItemRow, 'id' | 'organizationId' | 'version'>, actorUserId: string | null, action: BankItemEvent['action'], note: string | null = null) {
  await tx.insert(bankItemEvents).values({ organizationId: item.organizationId, bankItemId: item.id, actorUserId, action, version: item.version, note });
}

/** Loads items with their course titles and sources, in one query each. */
async function hydrate(rows: ItemRow[]): Promise<BankItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const docIds = [...new Set(rows.map((r) => r.documentId))];
  const [sources, docs] = await Promise.all([
    db.select().from(questionSources).where(inArray(questionSources.bankItemId, ids)).orderBy(asc(questionSources.createdAt)),
    db.select({ id: documents.id, title: documents.title }).from(documents).where(inArray(documents.id, docIds)),
  ]);
  const titles = new Map(docs.map((d) => [d.id, d.title]));
  return rows.map((r) =>
    toBankItem(
      r,
      titles.get(r.documentId) ?? '',
      sources.filter((s) => s.bankItemId === r.id),
    ),
  );
}

export async function listItems(
  orgId: string,
  q: { documentId?: string; status?: BankItemStatus; topic?: string; section?: string; limit: number; offset: number },
): Promise<BankItemList> {
  const where = and(
    eq(bankItems.organizationId, orgId),
    q.documentId ? eq(bankItems.documentId, q.documentId) : undefined,
    q.status ? eq(bankItems.status, q.status) : undefined,
    q.topic ? eq(bankItems.topic, q.topic) : undefined,
    q.section ? eq(bankItems.section, q.section) : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db.select().from(bankItems).where(where).orderBy(desc(bankItems.createdAt), asc(bankItems.id)).limit(q.limit).offset(q.offset),
    db.select({ n: count() }).from(bankItems).where(where),
  ]);
  return { items: await hydrate(rows), total: Number(total?.n ?? 0) };
}

export async function getItemRow(orgId: string, id: string): Promise<ItemRow> {
  const [row] = await db
    .select()
    .from(bankItems)
    .where(and(eq(bankItems.id, id), eq(bankItems.organizationId, orgId)));
  if (!row) throw new HttpError(404, 'Question not found', 'not_found');
  return row;
}

export async function getItem(orgId: string, id: string): Promise<BankItemDetail> {
  const row = await getItemRow(orgId, id);
  const [[item], events] = await Promise.all([
    hydrate([row]),
    db
      .select({ e: bankItemEvents, actorName: users.name })
      .from(bankItemEvents)
      .leftJoin(users, eq(users.id, bankItemEvents.actorUserId))
      .where(and(eq(bankItemEvents.bankItemId, id), eq(bankItemEvents.organizationId, orgId)))
      .orderBy(desc(bankItemEvents.createdAt)),
  ]);
  return {
    ...item,
    events: events.map(({ e, actorName }) => ({
      id: e.id,
      action: e.action as BankItemEvent['action'],
      actorUserId: e.actorUserId,
      actorName: actorName ?? null,
      version: e.version,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

const assertMcqShape = (type: 'mcq' | 'short_answer', options: string[] | null | undefined, correctAnswer: string) => {
  if (type === 'mcq') {
    if (!options || options.length < 2) throw new HttpError(400, 'A multiple-choice question needs at least two options', 'invalid_request');
    if (new Set(options.map((o) => o.trim().toLowerCase())).size !== options.length) throw new HttpError(400, 'Options must be different from each other', 'invalid_request');
    if (!options.includes(correctAnswer)) throw new HttpError(400, 'The correct answer must be one of the options', 'invalid_request');
  }
};

/** A question written by hand (no AI, no sources). Starts as a draft like every other item. */
export async function createManualItem(org: OrgContext, actorUserId: string, input: CreateBankItemInput): Promise<BankItem> {
  const doc = await getOrgDocument(org.id, input.documentId);
  const options = input.type === 'mcq' ? (input.options ?? null) : null;
  assertMcqShape(input.type, options, input.correctAnswer);
  const legalRef = input.legalRef ? legalRefSchema.parse(input.legalRef) : null;
  const row = await db.transaction(async (tx) => {
    const [item] = await tx
      .insert(bankItems)
      .values({
        organizationId: org.id,
        documentId: doc.id,
        type: input.type,
        topic: input.topic,
        section: input.section ?? null,
        stem: input.stem,
        options,
        correctAnswer: input.correctAnswer,
        explanation: input.explanation ?? '',
        difficulty: input.difficulty ?? null,
        legalRef,
        origin: 'manual',
        createdBy: actorUserId,
      })
      .returning();
    await tx.insert(bankItemRevisions).values({ bankItemId: item.id, version: 1, snapshot: snapshotOf(item), createdBy: actorUserId });
    await recordEvent(tx, item, actorUserId, 'created');
    return item;
  });
  return (await hydrate([row]))[0];
}

/**
 * Edits the content: a new version, back to draft (an approved item that changes must be approved again).
 * Changing only `section` or `legalRef` on an approved item keeps its approval (organizational metadata, not content).
 */
export async function updateItem(org: OrgContext, actorUserId: string, id: string, input: UpdateBankItemInput): Promise<BankItemDetail> {
  const current = await getItemRow(org.id, id);
  if (current.status === 'retired') throw new HttpError(409, 'A retired question cannot be edited', 'item_retired');
  const next = {
    topic: input.topic ?? current.topic,
    section: input.section === undefined ? current.section : input.section,
    stem: input.stem ?? current.stem,
    options: current.type === 'mcq' ? (input.options === undefined ? current.options : input.options) : null,
    correctAnswer: input.correctAnswer ?? current.correctAnswer,
    explanation: input.explanation ?? current.explanation,
    difficulty: input.difficulty === undefined ? current.difficulty : input.difficulty,
    legalRef: input.legalRef === undefined ? current.legalRef : input.legalRef ? legalRefSchema.parse(input.legalRef) : null,
  };
  assertMcqShape(current.type, next.options, next.correctAnswer);
  const contentChanged =
    next.stem !== current.stem ||
    next.correctAnswer !== current.correctAnswer ||
    next.explanation !== current.explanation ||
    next.topic !== current.topic ||
    next.difficulty !== current.difficulty ||
    JSON.stringify(next.options ?? null) !== JSON.stringify(current.options ?? null);
  await db.transaction(async (tx) => {
    const version = contentChanged ? current.version + 1 : current.version;
    const [updated] = await tx
      .update(bankItems)
      .set({
        ...next,
        version,
        ...(contentChanged ? { status: 'draft' as const, reviewedBy: null, reviewedAt: null, reviewNote: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(bankItems.id, id), eq(bankItems.organizationId, org.id)))
      .returning();
    if (contentChanged) {
      await tx.insert(bankItemRevisions).values({ bankItemId: id, version, snapshot: snapshotOf(updated), createdBy: actorUserId });
      await recordEvent(tx, updated, actorUserId, 'edited', current.status === 'approved' ? 'Edited after approval: needs review again' : null);
    } else {
      await recordEvent(tx, updated, actorUserId, 'edited', 'Metadata only');
    }
  });
  return getItem(org.id, id);
}

async function transition(org: OrgContext, actorUserId: string, id: string, from: BankItemStatus[], to: BankItemStatus, action: BankItemEvent['action'], note: string | null) {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bankItems)
      .set({ status: to, reviewedBy: actorUserId, reviewedAt: new Date(), reviewNote: note, updatedAt: new Date() })
      .where(and(eq(bankItems.id, id), eq(bankItems.organizationId, org.id), inArray(bankItems.status, from)))
      .returning();
    if (!updated) {
      await getItemRow(org.id, id); // 404 if it isn't ours
      throw new HttpError(409, `Only a ${from.join(' or ')} question can be ${action}`, 'item_status_conflict');
    }
    await recordEvent(tx, updated, actorUserId, action, note);
  });
  return getItem(org.id, id);
}

/** A person approves a draft. Never called by the system. */
export const approveItem = (org: OrgContext, actorUserId: string, id: string, note?: string) => transition(org, actorUserId, id, ['draft'], 'approved', 'approved', note ?? null);
export const rejectItem = (org: OrgContext, actorUserId: string, id: string, note?: string) => transition(org, actorUserId, id, ['draft'], 'rejected', 'rejected', note ?? null);
export const retireItem = (org: OrgContext, actorUserId: string, id: string, note?: string) => transition(org, actorUserId, id, ['approved'], 'retired', 'retired', note ?? null);
/** Back to draft (a rejected or retired question worth another look). */
export const reopenItem = (org: OrgContext, actorUserId: string, id: string, note?: string) => transition(org, actorUserId, id, ['rejected', 'retired'], 'draft', 'reopened', note ?? null);

export async function deleteItem(org: OrgContext, id: string): Promise<void> {
  const removed = await db
    .delete(bankItems)
    .where(and(eq(bankItems.id, id), eq(bankItems.organizationId, org.id)))
    .returning({ id: bankItems.id });
  if (removed.length === 0) throw new HttpError(404, 'Question not found', 'not_found');
}

/** Topics (and sections) of an organization's bank with counts per status, for organizing and exporting. */
export async function listTopics(orgId: string, documentId?: string): Promise<TopicCount[]> {
  const rows = await db
    .select({
      topic: bankItems.topic,
      section: bankItems.section,
      drafts: sql<number>`count(*) filter (where ${bankItems.status} = 'draft')`,
      approved: sql<number>`count(*) filter (where ${bankItems.status} = 'approved')`,
      rejected: sql<number>`count(*) filter (where ${bankItems.status} = 'rejected')`,
    })
    .from(bankItems)
    .where(and(eq(bankItems.organizationId, orgId), documentId ? eq(bankItems.documentId, documentId) : undefined))
    .groupBy(bankItems.topic, bankItems.section)
    .orderBy(asc(bankItems.section), asc(bankItems.topic));
  return rows.map((r) => ({ topic: r.topic, section: r.section, drafts: Number(r.drafts), approved: Number(r.approved), rejected: Number(r.rejected) }));
}
