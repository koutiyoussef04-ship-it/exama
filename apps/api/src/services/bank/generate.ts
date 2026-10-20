/**
 * Draft generation for an organization's question bank. Reuses the student engine (`studyAI.generateQuestions`
 * + `validateQuestions`), then goes further than a student exam does:
 *  1. the material is chosen explicitly (a topic and/or a page range of one course), and the chunks sent to
 *     the model are kept, so every reference points at material that was really retrieved;
 *  2. each kept question's quote is located in ONE chunk (page/time range, offsets, content hash) or marked
 *     unlocated — never a guessed page;
 *  3. deterministic checks and an advisory verifier call add review flags;
 *  4. everything is stored as `draft`. Nothing is approved here.
 *
 * Usage: `bank_items` reserved on the organization's allowance before the AI call, settled to what was kept.
 * Fewer questions than asked is a normal outcome (the checks discard some), not an error — unlike a student
 * exam, a bank doesn't need an exact count.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { GenerateBankItemsResult, OrganizationMarket, ReviewFlag, Verification } from '@study/shared';
import { marketProfile } from '@study/shared';
import { AIError, studyAI, type GeneratedQuestion } from '../../ai/index.js';
import { resolveOutputLanguage } from '../../ai/language.js';
import { withAIUsage } from '../../ai/usage.js';
import { releaseOrgReservation, reserveOrgItems, resolveOrgLimits, settleOrgReservation } from '../../billing/org-limits.js';
import type { OrgContext } from '../../auth/org-access.js';
import { db } from '../../db/client.js';
import { bankItemRevisions, bankItems, documentChunks, organizations, questionSources } from '../../db/schema.js';
import { HttpError } from '../../lib/errors.js';
import { MaterialIndex, validateQuestions } from '../../lib/grounding.js';
import { usableChunks } from '../chunks.js';
import { getOrgDocument } from '../org-documents.js';
import { locateQuote, type Location, type SourceChunk } from '../sources/locate.js';
import { reviewFlags, withVerdict } from './checks.js';
import { recordEvent, snapshotOf, toBankItem } from './service.js';

/** Same budget as a student exam (services/exams.ts). */
const EXCERPT_BUDGET_CHARS = 40_000;
/** Below this much selected text, generation is refused rather than producing questions from almost nothing. */
const MIN_SOURCE_CHARS = 400;

export type GenerateRequest = {
  count: number;
  topic?: string;
  pageStart?: number;
  pageEnd?: number;
  questionTypes?: 'mcq' | 'mixed';
  language?: string;
};

/** The chunks to generate from: the course's text (original + ready materials), optionally one page range, in reading order and within budget. */
async function selectSourceChunks(documentId: string, topic: string | undefined, pages: { start?: number; end?: number }): Promise<SourceChunk[]> {
  const rows = await db
    .select({
      id: documentChunks.id,
      content: documentChunks.content,
      materialId: documentChunks.materialId,
      pageStart: documentChunks.pageStart,
      pageEnd: documentChunks.pageEnd,
      startSeconds: documentChunks.startSeconds,
      endSeconds: documentChunks.endSeconds,
    })
    .from(documentChunks)
    .where(and(usableChunks(documentId), pages.start ? gte(documentChunks.pageEnd, pages.start) : undefined, pages.end ? lte(documentChunks.pageStart, pages.end) : undefined))
    .orderBy(asc(documentChunks.position));
  // Topic-first (chunks that mention the topic), then the rest in order, until the budget is spent.
  const t = topic?.toLowerCase();
  const ordered = t ? [...rows.filter((c) => c.content.toLowerCase().includes(t)), ...rows.filter((c) => !c.content.toLowerCase().includes(t))] : rows;
  const picked: SourceChunk[] = [];
  let used = 0;
  for (const c of ordered) {
    if (used + c.content.length > EXCERPT_BUDGET_CHARS && picked.length > 0) break;
    picked.push(c);
    used += c.content.length;
  }
  // Keep reading order in the prompt (positions are not selected above, so sort by page/time, then id order as fetched).
  const order = new Map(rows.map((c, i) => [c.id, i]));
  return picked.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function generateDraftItems(org: OrgContext, actorUserId: string, documentId: string, request: GenerateRequest): Promise<GenerateBankItemsResult> {
  const doc = await getOrgDocument(org.id, documentId);
  if (doc.status !== 'ready') throw new HttpError(409, 'The course is still processing', 'document_processing');
  if (request.topic !== undefined && !doc.topics.includes(request.topic)) throw new HttpError(400, 'Unknown topic for this course', 'invalid_request');
  if (request.pageStart && request.pageEnd && request.pageEnd < request.pageStart) throw new HttpError(400, 'The page range is empty', 'invalid_request');

  const profile = marketProfile(org.market as OrganizationMarket);
  const mcqOnly = (request.questionTypes ?? (profile.mcqOnly ? 'mcq' : 'mixed')) === 'mcq';
  const language = resolveOutputLanguage(request.language, doc.sourceLanguage, doc.summaryLanguage ?? 'en');

  const chunks = await selectSourceChunks(doc.id, request.topic, { start: request.pageStart, end: request.pageEnd });
  const totalChars = chunks.reduce((n, c) => n + c.content.length, 0);
  if (chunks.length === 0 || totalChars < MIN_SOURCE_CHARS) {
    throw new HttpError(422, 'Not enough text in the selected material to write questions from', 'insufficient_source', { chars: totalChars });
  }

  const [orgRow] = await db.select({ limits: organizations.limits }).from(organizations).where(eq(organizations.id, org.id));
  const limits = resolveOrgLimits(orgRow?.limits);
  const reservation = await reserveOrgItems(org.id, actorUserId, request.count, limits);
  const count = reservation.amount;

  try {
    const excerpts = chunks.map((c) => c.content);
    const material = new MaterialIndex(excerpts);
    const allowedTopics = request.topic ? [request.topic] : doc.topics;
    const kept: GeneratedQuestion[] = [];
    let generated = 0;
    const generate = async (n: number) => {
      const raw = await withAIUsage({ userId: actorUserId, organizationId: org.id, feature: 'bank_generation' }, () =>
        studyAI.generateQuestions({ excerpts, topics: doc.topics, focusTopics: request.topic ? [request.topic] : [], count: n, language, mcqOnly, avoid: kept.map((q) => q.prompt) }),
      );
      generated += raw.length;
      kept.push(...validateQuestions(raw, { material, allowedTopics, alreadyKept: kept }).kept);
    };
    await generate(count + 2);
    if (kept.length < count) await generate(count - kept.length + 2);
    const drafts = kept.slice(0, count);

    // Locate each quote in one chunk; deterministic checks; advisory verifier on the located passages.
    const located = drafts.map((q) => {
      const loc = locateQuote(chunks, q.sourceQuote);
      const passage = loc ? (chunks.find((c) => c.id === loc.chunkId)?.content ?? null) : null;
      return { q, loc, passage, flags: reviewFlags(q, loc, passage) };
    });
    const verdicts = await verify(org.id, actorUserId, located);

    const rows = await db.transaction(async (tx) => {
      const out = [];
      for (const [i, { q, loc, flags }] of located.entries()) {
        const verdict = verdicts.get(String(i)) ?? ({ verdict: 'unavailable', note: 'The verification call failed; this question was not checked.' } as Verification);
        const [item] = await tx
          .insert(bankItems)
          .values({
            organizationId: org.id,
            documentId: doc.id,
            type: q.type,
            topic: q.topic,
            stem: q.prompt,
            options: q.type === 'mcq' ? (q.options ?? null) : null,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            origin: 'ai',
            status: 'draft',
            reviewFlags: withVerdict(flags, verdict.verdict),
            verification: verdict,
            createdBy: actorUserId,
          })
          .returning();
        await tx.insert(bankItemRevisions).values({ bankItemId: item.id, version: 1, snapshot: snapshotOf(item), createdBy: actorUserId });
        const [source] = await tx
          .insert(questionSources)
          .values(sourceRow(org.id, item.id, doc.id, q, loc))
          .returning();
        await recordEvent(tx, item, actorUserId, 'generated', request.topic ? `Topic: ${request.topic}` : null);
        out.push(toBankItem(item, doc.title, [source]));
      }
      return out;
    });
    await settleOrgReservation(reservation, rows.length);
    return { items: rows, requested: count, discarded: Math.max(0, generated - kept.length) };
  } catch (err) {
    await releaseOrgReservation(reservation).catch(() => {});
    throw err;
  }
}

function sourceRow(organizationId: string, bankItemId: string, documentId: string, q: GeneratedQuestion, loc: Location | null) {
  return loc
    ? {
        organizationId,
        bankItemId,
        documentId,
        materialId: loc.materialId,
        chunkId: loc.chunkId,
        chunkHash: loc.chunkHash,
        pageStart: loc.pageStart,
        pageEnd: loc.pageEnd,
        startSeconds: loc.startSeconds,
        endSeconds: loc.endSeconds,
        quote: q.sourceQuote,
        quoteStart: loc.quoteStart,
        quoteEnd: loc.quoteEnd,
        matchScore: loc.matchScore,
        located: true,
      }
    : // The quote passed the grounding check only across passages: keep it, claim no location.
      { organizationId, bankItemId, documentId, materialId: null, chunkId: null, chunkHash: '', pageStart: null, pageEnd: null, startSeconds: null, endSeconds: null, quote: q.sourceQuote, quoteStart: null, quoteEnd: null, matchScore: 0, located: false };
}

/** One verifier call for the located questions. A failure never fails generation: those items are flagged "verifier unavailable". */
async function verify(orgId: string, actorUserId: string, located: { q: GeneratedQuestion; passage: string | null; flags: ReviewFlag[] }[]): Promise<Map<string, Verification>> {
  const out = new Map<string, Verification>();
  const toCheck = located.map((x, i) => ({ i, ...x })).filter((x) => x.passage);
  for (const x of located.map((v, i) => ({ v, i })).filter((x) => !x.v.passage)) {
    out.set(String(x.i), { verdict: 'unavailable', note: 'The quote could not be placed in one passage, so the answer was not checked against it.' });
  }
  if (toCheck.length === 0) return out;
  try {
    const verdicts = await withAIUsage({ userId: actorUserId, organizationId: orgId, feature: 'bank_verification' }, () =>
      studyAI.verifyQuestions(
        toCheck.map((x) => ({ id: String(x.i), prompt: x.q.prompt, options: x.q.options ?? null, correctAnswer: x.q.correctAnswer, explanation: x.q.explanation, passage: x.passage! })),
      ),
    );
    for (const v of verdicts) out.set(v.id, { verdict: v.verdict, note: v.note });
  } catch (err) {
    console.warn('[bank] verifier unavailable:', err instanceof AIError ? `${err.code}: ${err.detail}` : err);
  }
  return out;
}
