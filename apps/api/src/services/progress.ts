import { and, asc, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { WEAK_TOPIC_THRESHOLD, type DocumentProgress } from '@study/shared';
import { getEntitlement } from '../billing/entitlements.js';
import { db } from '../db/client.js';
import { answers, documents, exams, questions, topicMastery } from '../db/schema.js';
import type { MissedQuestion } from '../ai/index.js';
import { toExamSummary } from './exams.js';

/** Weight of the newest result in the running mastery score (exponential moving average). */
const RECENCY_WEIGHT = 0.5;

/** Folds one graded exam's per-topic scores into the student's running mastery. */
export async function updateMastery(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  documentId: string,
  perTopic: Map<string, number[]>,
) {
  for (const [topic, scores] of perTopic) {
    const score = scores.reduce((a, b) => a + b, 0) / scores.length;
    await tx
      .insert(topicMastery)
      .values({ userId, documentId, topic, mastery: score, lastScore: score, attempts: 1 })
      .onConflictDoUpdate({
        target: [topicMastery.userId, topicMastery.documentId, topicMastery.topic],
        set: {
          mastery: sql`${topicMastery.mastery} * ${1 - RECENCY_WEIGHT} + ${score * RECENCY_WEIGHT}`,
          lastScore: score,
          attempts: sql`${topicMastery.attempts} + 1`,
          updatedAt: new Date(),
        },
      });
  }
}

/** Current course topics (a removed lecture's topics no longer count as weak areas). */
const courseTopics = async (documentId: string) =>
  new Set((await db.select({ topics: documents.topics }).from(documents).where(eq(documents.id, documentId)))[0]?.topics ?? []);

export async function getWeakTopics(userId: string, documentId: string, limit = 3): Promise<string[]> {
  const current = await courseTopics(documentId);
  const rows = await db
    .select({ topic: topicMastery.topic })
    .from(topicMastery)
    .where(
      and(
        eq(topicMastery.userId, userId),
        eq(topicMastery.documentId, documentId),
        lt(topicMastery.mastery, WEAK_TOPIC_THRESHOLD),
      ),
    )
    .orderBy(asc(topicMastery.mastery));
  return rows
    .map((r) => r.topic)
    .filter((t) => current.has(t))
    .slice(0, limit);
}

/**
 * Non-adaptive practice (Basic/Free): the course topics practised least so far (course order on
 * ties) — coverage, not weakness. Uses how often a topic was examined, never its score.
 */
export async function getLeastPractisedTopics(userId: string, documentId: string, courseTopicList: string[], limit = 3): Promise<string[]> {
  const rows = await db
    .select({ topic: topicMastery.topic, attempts: topicMastery.attempts })
    .from(topicMastery)
    .where(and(eq(topicMastery.userId, userId), eq(topicMastery.documentId, documentId)));
  const attempts = new Map(rows.map((r) => [r.topic, r.attempts]));
  return courseTopicList
    .map((topic, i) => ({ topic, i, n: attempts.get(topic) ?? 0 }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .slice(0, limit)
    .map((t) => t.topic);
}

/** Most recent questions the student got wrong on the given topics — context for follow-ups. */
export async function getRecentMisses(userId: string, documentId: string, topics: string[], limit = 6): Promise<MissedQuestion[]> {
  if (topics.length === 0) return [];
  return db
    .select({
      topic: questions.topic,
      prompt: questions.prompt,
      userAnswer: answers.userAnswer,
      correctAnswer: questions.correctAnswer,
    })
    .from(answers)
    .innerJoin(questions, eq(answers.questionId, questions.id))
    .innerJoin(exams, eq(questions.examId, exams.id))
    .where(
      and(
        eq(exams.userId, userId),
        eq(exams.documentId, documentId),
        eq(answers.isCorrect, false),
        inArray(questions.topic, topics),
      ),
    )
    .orderBy(desc(answers.createdAt))
    .limit(limit);
}

/**
 * Course progress. The per-topic mastery / weak-topic analysis is a Student/Pro/trial feature:
 * on Basic/Free only the exam history is returned (`analysisLocked`), and nothing else leaks it.
 */
export async function getProgress(userId: string, documentId: string): Promise<DocumentProgress> {
  const [{ features }, current, mastery, examRows] = await Promise.all([
    getEntitlement(userId),
    courseTopics(documentId),
    db
      .select()
      .from(topicMastery)
      .where(and(eq(topicMastery.userId, userId), eq(topicMastery.documentId, documentId)))
      .orderBy(asc(topicMastery.mastery)),
    // Exams with their question counts. (A correlated raw-SQL subquery here once rendered unqualified
    // column names — `exam_id = id` inside the subquery — and counted 0 questions for every exam.)
    db
      .select({ exam: exams, questionCount: count(questions.id) })
      .from(exams)
      .leftJoin(questions, eq(questions.examId, exams.id))
      .where(and(eq(exams.userId, userId), eq(exams.documentId, documentId)))
      .groupBy(exams.id)
      .orderBy(desc(exams.createdAt)),
  ]);
  const topics = mastery.filter((m) => current.has(m.topic)).map((m) => ({
    topic: m.topic,
    mastery: m.mastery,
    attempts: m.attempts,
    lastScore: m.lastScore,
  }));
  const locked = !features.weakTopicAnalysis;
  return {
    documentId,
    analysisLocked: locked,
    topics: locked ? [] : topics,
    weakTopics: locked ? [] : topics.filter((t) => t.mastery < WEAK_TOPIC_THRESHOLD).map((t) => t.topic),
    exams: examRows.map((r) => toExamSummary(r.exam, r.questionCount)),
  };
}
