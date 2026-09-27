import { and, asc, eq } from 'drizzle-orm';
import type { CreateExamInput, Exam, ExamSummary, GradedQuestion, Question, SubmitExamInput } from '@study/shared';
import { AIError, studyAI } from '../ai/index.js';
import { resolveOutputLanguage } from '../ai/language.js';
import { track } from '../analytics/index.js';
import { getEntitlement, releaseReservation, reserveExamGeneration, settleReservation } from '../billing/entitlements.js';
import { db } from '../db/client.js';
import { answers, documentChunks, exams, questions } from '../db/schema.js';
import { usableChunks } from './chunks.js';
import { HttpError } from '../lib/errors.js';
import { MaterialIndex, validateQuestions } from '../lib/grounding.js';
import { getOwnedDocument } from './documents.js';
import { getLeastPractisedTopics, getRecentMisses, getWeakTopics, updateMastery } from './progress.js';
import { linkExamToTask, onExamGraded, taskForExam } from './study-plans.js';

type ExamRow = typeof exams.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;

/** How much source text we send to the model per exam. */
const EXCERPT_BUDGET_CHARS = 40_000;

export const toExamSummary = (e: ExamRow, questionCount: number): ExamSummary => ({
  id: e.id,
  documentId: e.documentId,
  kind: e.kind,
  status: e.status,
  score: e.score,
  questionCount,
  language: e.language,
  createdAt: e.createdAt.toISOString(),
});

/** Feedback the server writes itself (MCQ / blank answers), in the exam's language. */
const FEEDBACK: Record<string, { blank: string; correct: string; incorrect: string }> = {
  en: { blank: 'No answer given.', correct: 'Correct!', incorrect: 'Incorrect.' },
  es: { blank: 'Sin respuesta.', correct: '¡Correcto!', incorrect: 'Incorrecto.' },
  fr: { blank: 'Aucune réponse.', correct: 'Correct !', incorrect: 'Incorrect.' },
  ar: { blank: 'لم تُقدَّم إجابة.', correct: 'إجابة صحيحة!', incorrect: 'إجابة خاطئة.' },
};
const feedbackFor = (lang: string) => FEEDBACK[lang] ?? FEEDBACK.en;

const toQuestion = (q: QuestionRow): Question => ({
  id: q.id,
  position: q.position,
  type: q.type,
  topic: q.topic,
  prompt: q.prompt,
  options: q.options ?? null,
});

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Picks chunks to send as context: ones mentioning focus topics first, then an even spread. */
async function selectExcerpts(documentId: string, focusTopics: string[]): Promise<string[]> {
  const chunks = await db
    .select({ content: documentChunks.content })
    .from(documentChunks)
    .where(usableChunks(documentId))
    .orderBy(asc(documentChunks.position));

  const focus = focusTopics.map((t) => t.toLowerCase());
  const relevant = chunks.filter((c) => focus.some((t) => c.content.toLowerCase().includes(t)));
  const step = Math.max(1, Math.floor(chunks.length / 12));
  const spread = chunks.filter((_, i) => i % step === 0);

  const picked: string[] = [];
  let used = 0;
  for (const c of [...relevant, ...spread, ...chunks]) {
    if (picked.includes(c.content)) continue;
    if (used + c.content.length > EXCERPT_BUDGET_CHARS && picked.length > 0) break;
    picked.push(c.content);
    used += c.content.length;
  }
  return picked;
}

type ExamRequest = Required<Pick<CreateExamInput, 'kind' | 'questionCount'>> & Pick<CreateExamInput, 'language' | 'studyTaskId' | 'focusTopic'>;

export async function createExam(userId: string, documentId: string, request: ExamRequest): Promise<Exam> {
  const doc = await getOwnedDocument(userId, documentId);
  if (doc.status !== 'ready') throw new HttpError(409, 'Document is still processing', 'document_processing');
  // Questions/feedback language: what the student asked for, else the language the course summary is in.
  const language = resolveOutputLanguage(request.language, doc.sourceLanguage, doc.summaryLanguage ?? 'en');
  let input = { kind: request.kind, questionCount: request.questionCount, language };

  // Started from a study-plan task: the task decides the kind and topic (checked before any AI cost).
  const task = request.studyTaskId ? await taskForExam(userId, doc.id, request.studyTaskId) : null;
  let focusTopic = request.focusTopic;
  if (task) {
    input = { ...input, kind: task.activity === 'exam' ? 'standard' : 'follow_up' };
    focusTopic = task.topic ?? undefined;
  }
  if (focusTopic !== undefined && !doc.topics.includes(focusTopic)) throw new HttpError(400, 'Unknown topic for this course', 'invalid_request');

  // Adaptive practice (Student, Pro, trial) targets the weak topics and revisits missed questions;
  // Basic/Free practice rotates through the course topics (least practised first).
  const adaptive = input.kind === 'follow_up' ? (await getEntitlement(userId)).features.adaptivePractice : true;
  let focusTopics: string[] = [];
  if (input.kind === 'follow_up' && focusTopic) {
    focusTopics = [focusTopic];
  } else if (input.kind === 'follow_up' && task) {
    focusTopics = doc.topics.slice(0, 3); // whole-course practice task
  } else if (input.kind === 'follow_up' && !adaptive) {
    focusTopics = await getLeastPractisedTopics(userId, documentId, doc.topics);
    if (focusTopics.length === 0) throw new HttpError(409, 'This course has no topics to practise yet', 'no_topics');
  } else if (input.kind === 'follow_up') {
    focusTopics = await getWeakTopics(userId, documentId);
    if (focusTopics.length === 0) {
      throw new HttpError(409, 'No weak areas yet — complete an exam first, or you have mastered every topic!', 'no_weak_topics');
    }
  }

  // Plan check + usage reservation before any AI cost. Practice sets may be trimmed to the remaining allowance.
  const reservation = await reserveExamGeneration(userId, input.kind, input.questionCount);
  input = { ...input, questionCount: reservation.questionCount };

  const startedAt = Date.now();
  const base = { document_id: documentId, kind: input.kind };
  void track('exam_generation_started', userId, { ...base, question_count: input.questionCount, language });
  try {
    const exam = await generateExam(userId, doc, input, focusTopics, adaptive).catch(async (err) => {
      await releaseReservation(reservation); // nothing was delivered, so nothing is charged
      throw err;
    });
    await settleReservation(reservation, input.kind === 'follow_up' ? exam.questions.length : 1);
    if (task) await linkExamToTask(task.id, exam.id);
    void track('exam_generation_completed', userId, {
      ...base,
      success: true,
      duration_ms: Date.now() - startedAt,
      exam_id: exam.id,
      question_count: exam.questions.length,
      focus_topic_count: focusTopics.length,
    });
    return exam;
  } catch (err) {
    void track('exam_generation_completed', userId, {
      ...base,
      success: false,
      duration_ms: Date.now() - startedAt,
      failure_reason: err instanceof AIError ? `ai_${err.code}` : 'other',
    });
    throw err;
  }
}

async function generateExam(
  userId: string,
  doc: Awaited<ReturnType<typeof getOwnedDocument>>,
  input: { kind: 'standard' | 'follow_up'; questionCount: number; language: string },
  focusTopics: string[],
  adaptive = true,
): Promise<Exam> {
  const documentId = doc.id;
  const excerpts = await selectExcerpts(documentId, focusTopics);
  const raw = await studyAI.generateQuestions({
    excerpts,
    topics: doc.topics,
    // Ask for a couple extra: some may be discarded by the grounding check below.
    count: input.questionCount + 2,
    focusTopics,
    // Revisiting the student's own mistakes is part of adaptive practice.
    missed: adaptive ? await getRecentMisses(userId, documentId, focusTopics) : [],
    language: input.language,
  });

  // Keep only questions whose supporting quote really comes from the uploaded material.
  const { kept, rejected } = validateQuestions(raw, {
    material: new MaterialIndex(excerpts),
    allowedTopics: focusTopics.length ? focusTopics : doc.topics,
  });
  const dropped = raw.length - kept.length;
  if (dropped > 0) console.warn(`[exam] dropped ${dropped}/${raw.length} generated questions`, rejected);
  if (kept.length === 0) {
    throw new AIError('bad_output', `No valid grounded questions (rejected: ${JSON.stringify(rejected)})`);
  }
  const generated = kept.slice(0, input.questionCount);

  return db.transaction(async (tx) => {
    const [exam] = await tx.insert(exams).values({ userId, documentId, kind: input.kind, focusTopics, language: input.language }).returning();
    const qs = await tx
      .insert(questions)
      .values(generated.map((q, i) => ({ ...q, examId: exam.id, position: i })))
      .returning();
    return { ...toExamSummary(exam, qs.length), questions: qs.sort((a, b) => a.position - b.position).map(toQuestion) };
  });
}

async function getOwnedExam(userId: string, examId: string) {
  const [exam] = await db
    .select()
    .from(exams)
    .where(and(eq(exams.id, examId), eq(exams.userId, userId)));
  if (!exam) throw new HttpError(404, 'Exam not found', 'not_found');
  return exam;
}

export async function getExam(userId: string, examId: string): Promise<Exam> {
  const exam = await getOwnedExam(userId, examId);
  const rows = await db
    .select({ q: questions, a: answers })
    .from(questions)
    .leftJoin(answers, eq(answers.questionId, questions.id))
    .where(eq(questions.examId, exam.id))
    .orderBy(asc(questions.position));

  const summary = toExamSummary(exam, rows.length);
  if (exam.status !== 'graded') return { ...summary, questions: rows.map((r) => toQuestion(r.q)) };

  const graded: GradedQuestion[] = rows.map(({ q, a }) => ({
    ...toQuestion(q),
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    sourceQuote: q.sourceQuote,
    userAnswer: a?.userAnswer ?? '',
    score: a?.score ?? 0,
    isCorrect: a?.isCorrect ?? false,
    feedback: a?.feedback ?? '',
  }));
  return { ...summary, questions: graded };
}

/** Grades the exam (MCQ locally, short answers via AI), stores answers and updates topic mastery. */
export async function submitExam(userId: string, examId: string, input: SubmitExamInput): Promise<Exam> {
  const exam = await getOwnedExam(userId, examId);
  if (exam.status === 'graded') throw new HttpError(409, 'Exam already submitted', 'exam_already_submitted');

  const qs = await db.select().from(questions).where(eq(questions.examId, exam.id));
  const given = new Map(input.answers.map((a) => [a.questionId, a.answer.trim()]));

  const results = new Map<string, { score: number; feedback: string }>();
  const shortAnswers = [];
  const fb = feedbackFor(exam.language);
  for (const q of qs) {
    const userAnswer = given.get(q.id) ?? '';
    if (!userAnswer) {
      results.set(q.id, { score: 0, feedback: fb.blank });
    } else if (q.type === 'mcq') {
      const ok = normalize(userAnswer) === normalize(q.correctAnswer);
      results.set(q.id, { score: ok ? 1 : 0, feedback: ok ? fb.correct : `${fb.incorrect} ${q.explanation}` });
    } else {
      shortAnswers.push({ id: q.id, prompt: q.prompt, correctAnswer: q.correctAnswer, sourceQuote: q.sourceQuote, userAnswer });
    }
  }
  for (const g of await studyAI.gradeShortAnswers(shortAnswers, { language: exam.language })) {
    if (results.has(g.id) || !qs.some((q) => q.id === g.id)) continue;
    results.set(g.id, { score: Math.max(0, Math.min(1, g.score)), feedback: g.feedback });
  }
  // Never silently give 0 for an answer the AI failed to grade; the exam stays open so the student can resubmit.
  if (shortAnswers.some((s) => !results.has(s.id))) throw new AIError('bad_output', 'Grader skipped some answers');

  const perTopic = new Map<string, number[]>();
  for (const q of qs) perTopic.set(q.topic, [...(perTopic.get(q.topic) ?? []), results.get(q.id)!.score]);
  const total = qs.reduce((sum, q) => sum + results.get(q.id)!.score, 0) / Math.max(qs.length, 1);

  await db.transaction(async (tx) => {
    // Conditional update guards against a double submit racing past the check above.
    const claimed = await tx
      .update(exams)
      .set({ status: 'graded', score: total, gradedAt: new Date() })
      .where(and(eq(exams.id, exam.id), eq(exams.status, 'in_progress')))
      .returning({ id: exams.id });
    if (claimed.length === 0) throw new HttpError(409, 'Exam already submitted', 'exam_already_submitted');
    await tx.insert(answers).values(
      qs.map((q) => {
        const r = results.get(q.id)!;
        return { questionId: q.id, userAnswer: given.get(q.id) ?? '', score: r.score, isCorrect: r.score >= 0.7, feedback: r.feedback };
      }),
    );
    await updateMastery(tx, userId, exam.documentId, perTopic);
  });

  // Adapt the study plan (if any) to the new results; completes the task this exam came from.
  await onExamGraded(userId, exam.documentId, exam.id);

  void trackCompletion(userId, exam, {
    question_count: qs.length,
    answered_count: qs.filter((q) => given.get(q.id)).length,
    score_pct: Math.round(total * 100),
  });
  return getExam(userId, examId);
}

/** exam_completed / practice_completed with the post-grading weak-topic count. Never throws. */
async function trackCompletion(
  userId: string,
  exam: ExamRow,
  props: { question_count: number; answered_count: number; score_pct: number },
) {
  try {
    const weak = await getWeakTopics(userId, exam.documentId, 1000);
    await track(exam.kind === 'follow_up' ? 'practice_completed' : 'exam_completed', userId, {
      exam_id: exam.id,
      document_id: exam.documentId,
      ...props,
      weak_topic_count: weak.length,
      duration_s: Math.round((Date.now() - exam.createdAt.getTime()) / 1000),
    });
  } catch (err) {
    console.error('[analytics] completion event failed:', err instanceof Error ? err.message : err);
  }
}
