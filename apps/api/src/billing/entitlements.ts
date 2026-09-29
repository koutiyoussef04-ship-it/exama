/**
 * Entitlements: what a user may do right now. Always computed on the server from
 *   owner config → subscription state → plan limits → usage (this month, or this trial).
 * Nothing the client sends can change the outcome.
 *
 * Usage is reserved in the ledger *before* any AI work, inside a per-user lock, so parallel
 * requests can't both slip under a limit. A failed AI generation releases its reservation.
 */
import { and, count, eq, gte, inArray, sql, sum } from 'drizzle-orm';
import type { AccessPlan, Entitlement, Features, LectureAllowance, Limits, Tier, Usage } from '@study/shared';
import { normalizePlanId, planById } from '@study/shared';
import { config } from '../config.js';
import { db } from '../db/client.js';
import { documents, usageLedger, users } from '../db/schema.js';
import { LimitError } from './errors.js';
import { OWNER_FEATURES, TIER_FEATURES } from './features.js';
import { LIMITS, UNLIMITED } from './limits.js';
import { expireIfLapsed, getSubscription, isTrialPeriod, trialStartedAt, type Exec } from './subscriptions.js';

type UsageKind = (typeof usageLedger.$inferInsert)['kind'];
type Tx = Parameters<Parameters<(typeof db)['transaction']>[0]>[0];

/** Owner accounts: matched on the authenticated user's id or stored email, from server config only. */
export async function isOwner(userId: string, exec: Exec = db): Promise<boolean> {
  if (config.OWNER_USER_IDS.includes(userId)) return true;
  if (config.OWNER_EMAILS.length === 0) return false;
  const [u] = await exec.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return !!u && config.OWNER_EMAILS.includes(u.email.toLowerCase());
}

export const monthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const nextMonthStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

/**
 * Current courses + ledger totals since `since` (month start, or trial start). Lecture usage can
 * cover a different window (`mediaSince`): the Free plan's single lecture counts the account's whole
 * history, so it never comes back — not next month, not after deleting the course or re-uploading.
 */
async function getUsage(userId: string, since: Date, exec: Exec, mediaSince: Date = since): Promise<Usage> {
  const [[courses], ledger, media] = await Promise.all([
    exec.select({ n: count() }).from(documents).where(eq(documents.userId, userId)),
    exec
      .select({ kind: usageLedger.kind, total: sum(usageLedger.amount) })
      .from(usageLedger)
      .where(and(eq(usageLedger.userId, userId), gte(usageLedger.createdAt, since)))
      .groupBy(usageLedger.kind),
    +mediaSince === +since
      ? null
      : exec
          .select({ kind: usageLedger.kind, total: sum(usageLedger.amount) })
          .from(usageLedger)
          .where(and(eq(usageLedger.userId, userId), gte(usageLedger.createdAt, mediaSince), inArray(usageLedger.kind, ['media_upload', 'media_minutes'])))
          .groupBy(usageLedger.kind),
  ]);
  const used = (k: UsageKind, rows = ledger) => Number(rows.find((r) => r.kind === k)?.total ?? 0);
  return {
    courses: Number(courses?.n ?? 0),
    courseUploadsThisMonth: used('course_upload'),
    examGenerationsThisMonth: used('exam_generation'),
    practiceQuestionsThisMonth: used('practice_questions'),
    studyPlansThisMonth: used('study_plan_generation'),
    mediaUploadsThisMonth: used('media_upload', media ?? ledger),
    mediaMinutesThisMonth: used('media_minutes', media ?? ledger),
  };
}

/** The start of time for usage purposes: "per account" allowances count everything. */
const ACCOUNT_LIFETIME = new Date(0);

/** How a tier's lecture allowance works (see LectureAllowance). */
export function lectureAllowanceFor(tier: Tier, features: Features, limits: Limits, owner = false): LectureAllowance {
  if (owner) return 'unlimited';
  if (!features.lectures || limits.mediaUploadsPerMonth === 0 || limits.mediaMinutesPerMonth === 0) return 'none';
  if (tier === 'free') return 'once';
  if (tier === 'trial') return 'trial';
  return limits.mediaMinutesPerMonth === null ? 'unlimited' : 'monthly';
}

export async function getEntitlement(userId: string, exec: Exec = db): Promise<Entitlement> {
  const [owner, rawSub] = await Promise.all([isOwner(userId, exec), getSubscription(userId, exec)]);
  const monthly = async (mediaSince?: Date) => ({
    usage: await getUsage(userId, monthStart(), exec, mediaSince),
    usagePeriod: 'month' as const,
    usageResetsAt: nextMonthStart().toISOString(),
    trialEnded: false,
  });

  if (owner) {
    return {
      ...(await monthly()),
      accessPlan: 'complimentary', // never "owner" in a response (see resolveAccessPlan)
      tier: 'pro',
      features: OWNER_FEATURES,
      lectureAllowance: 'unlimited',
      provider: null,
      status: 'complimentary',
      isPremium: true,
      planId: null,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      willRenew: false,
      trialEligible: false,
      limits: UNLIMITED,
    };
  }

  const sub = rawSub ? await expireIfLapsed(rawSub, new Date(), exec) : null;
  const planId = sub ? normalizePlanId(sub.planId) : null;
  // An unknown stored plan (should never happen after migration 0007) gives no paid access.
  if (!sub || sub.status === 'expired' || !planId) {
    // A row with no dates is a reset account that has used its trial (see the mock state tool).
    const status = sub && (sub.currentPeriodEndsAt || sub.trialEndsAt) ? 'expired' : 'free';
    // Free lecture: one per account, so lecture usage counts the whole account history (a lecture
    // used during a trial or a past subscription has already used it up).
    return {
      ...(await monthly(ACCOUNT_LIFETIME)),
      accessPlan: status,
      tier: 'free',
      features: TIER_FEATURES.free,
      lectureAllowance: lectureAllowanceFor('free', TIER_FEATURES.free, LIMITS.free),
      provider: null,
      status,
      isPremium: false,
      planId,
      trialEndsAt: null,
      currentPeriodEndsAt: sub?.currentPeriodEndsAt?.toISOString() ?? null,
      willRenew: false,
      trialEligible: !sub?.trialUsed,
      limits: LIMITS.free,
      trialEnded: !!sub && !!sub.trialEndsAt && isTrialPeriod(sub),
    };
  }

  if (isTrialPeriod(sub)) {
    // Free trial (also after cancelling, until it ends): trial limits over the whole trial.
    const endsAt = (sub.trialEndsAt ?? sub.currentPeriodEndsAt)!.toISOString();
    return {
      accessPlan: 'trial',
      tier: 'trial',
      features: TIER_FEATURES.trial,
      lectureAllowance: lectureAllowanceFor('trial', TIER_FEATURES.trial, LIMITS.trial),
      provider: sub.provider,
      status: sub.status,
      isPremium: false,
      planId,
      trialEndsAt: endsAt,
      currentPeriodEndsAt: endsAt,
      willRenew: sub.willRenew,
      trialEligible: false,
      limits: LIMITS.trial,
      usage: await getUsage(userId, trialStartedAt(sub), exec),
      usagePeriod: 'trial',
      usageResetsAt: endsAt,
      trialEnded: false,
    };
  }

  const tier = planById(planId).tier;
  return {
    ...(await monthly()),
    accessPlan: planId,
    tier,
    features: TIER_FEATURES[tier],
    lectureAllowance: lectureAllowanceFor(tier, TIER_FEATURES[tier], LIMITS[tier]),
    provider: sub.provider,
    status: sub.status,
    isPremium: true,
    planId,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    currentPeriodEndsAt: sub.currentPeriodEndsAt?.toISOString() ?? null,
    willRenew: sub.willRenew,
    trialEligible: !sub.trialUsed,
    limits: LIMITS[tier],
  };
}

/**
 * The resolver's full answer, server-side only (support scripts, tests): the public access plan,
 * or `owner` for owner accounts.
 */
export async function resolveAccessPlan(userId: string, exec: Exec = db): Promise<AccessPlan> {
  if (await isOwner(userId, exec)) return 'owner';
  const e = await getEntitlement(userId, exec);
  return e.accessPlan === 'complimentary' ? 'owner' : e.accessPlan;
}

const over = (limit: number | null, used: number) => limit !== null && used >= limit;

function checkCanAddCourse(e: Entitlement): void {
  const { limits: l, usage: u } = e;
  if (over(l.courses, u.courses)) throw new LimitError('limit_reached', 'courses', l.courses!, u.courses, e.tier);
  if (over(l.courseUploadsPerMonth, u.courseUploadsThisMonth)) {
    throw new LimitError('limit_reached', 'course_uploads', l.courseUploadsPerMonth!, u.courseUploadsThisMonth, e.tier);
  }
}

/** Fast pre-check (no reservation): throws LimitError (402) if the user can't add another course. */
export async function assertCanAddCourse(userId: string): Promise<void> {
  checkCanAddCourse(await getEntitlement(userId));
}

/** Serializes limit checks + reservations per user until the transaction ends. */
async function lockUsage(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`usage:${userId}`}, 0))`);
}

/**
 * Authoritative upload check. Runs inside the transaction that inserts the document, so the
 * course count, the upload reservation and the new course commit (or roll back) together.
 */
export async function reserveCourseUpload(tx: Tx, userId: string): Promise<void> {
  await lockUsage(tx, userId);
  checkCanAddCourse(await getEntitlement(userId, tx));
  await tx.insert(usageLedger).values({ userId, kind: 'course_upload', amount: 1 });
}

export type Reservation = { id: string; kind: UsageKind; amount: number; questionCount: number };

/**
 * Checks an exam/practice request against the plan and reserves the allowance before any AI cost.
 * Practice sets are trimmed to the remaining allowance. Throws LimitError (402) otherwise.
 */
export async function reserveExamGeneration(userId: string, kind: 'standard' | 'follow_up', requested: number): Promise<Reservation> {
  return db.transaction(async (tx) => {
    await lockUsage(tx, userId);
    const e = await getEntitlement(userId, tx);
    const { limits: l, usage: u } = e;
    if (requested > l.maxQuestionsPerExam) {
      throw new LimitError('premium_required', 'exam_length', l.maxQuestionsPerExam, requested, e.tier);
    }
    let questionCount = requested;
    if (kind === 'standard') {
      if (over(l.examGenerationsPerMonth, u.examGenerationsThisMonth)) {
        throw new LimitError('limit_reached', 'exam_generations', l.examGenerationsPerMonth!, u.examGenerationsThisMonth, e.tier);
      }
    } else if (l.practiceQuestionsPerMonth !== null) {
      const remaining = l.practiceQuestionsPerMonth - u.practiceQuestionsThisMonth;
      if (remaining <= 0) {
        throw new LimitError('limit_reached', 'practice_questions', l.practiceQuestionsPerMonth, u.practiceQuestionsThisMonth, e.tier);
      }
      questionCount = Math.min(requested, remaining);
    }
    const ledgerKind: UsageKind = kind === 'standard' ? 'exam_generation' : 'practice_questions';
    const amount = kind === 'standard' ? 1 : questionCount;
    const [row] = await tx.insert(usageLedger).values({ userId, kind: ledgerKind, amount }).returning({ id: usageLedger.id });
    return { id: row.id, kind: ledgerKind, amount, questionCount };
  });
}

/** Checks the study-plan allowance and reserves one generation before the AI call. */
export async function reserveStudyPlanGeneration(userId: string): Promise<Reservation> {
  return db.transaction(async (tx) => {
    await lockUsage(tx, userId);
    const e = await getEntitlement(userId, tx);
    if (over(e.limits.studyPlansPerMonth, e.usage.studyPlansThisMonth)) {
      throw new LimitError('limit_reached', 'study_plans', e.limits.studyPlansPerMonth!, e.usage.studyPlansThisMonth, e.tier);
    }
    const [row] = await tx.insert(usageLedger).values({ userId, kind: 'study_plan_generation', amount: 1 }).returning({ id: usageLedger.id });
    return { id: row.id, kind: 'study_plan_generation' as const, amount: 1, questionCount: 0 };
  });
}

// ---------------------------------------------------------------- course materials

export const minutesFor = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

/** Audio/video lectures are a plan feature (Free's single lecture, trial, Student, Pro) — not just a zero allowance. */
function assertLectures(e: Entitlement): void {
  if (e.lectureAllowance === 'none') throw new LimitError('premium_required', 'lectures', 0, 0, e.tier);
}

function checkMedia(e: Entitlement, minutes: number): void {
  const { limits: l, usage: u } = e;
  if (minutes > l.maxMediaMinutesPerFile) {
    throw new LimitError('premium_required', 'media_length', l.maxMediaMinutesPerFile, u.mediaMinutesThisMonth, e.tier, minutes);
  }
  if (l.mediaMinutesPerMonth !== null && u.mediaMinutesThisMonth + minutes > l.mediaMinutesPerMonth) {
    throw new LimitError('limit_reached', 'media_minutes', l.mediaMinutesPerMonth, u.mediaMinutesThisMonth, e.tier, minutes);
  }
}

/**
 * Quick 402 before a (possibly large) upload is streamed, based on the declared type only.
 * The authoritative check runs in reserveMaterialUpload once the real format and length are known.
 */
export async function assertCanUploadMaterial(userId: string, kindHint: 'pdf' | 'media' | null): Promise<void> {
  const e = await getEntitlement(userId);
  const { limits: l, usage: u } = e;
  if (kindHint === 'media') assertLectures(e);
  if (kindHint === 'pdf' && over(l.courseUploadsPerMonth, u.courseUploadsThisMonth)) {
    throw new LimitError('limit_reached', 'course_uploads', l.courseUploadsPerMonth!, u.courseUploadsThisMonth, e.tier);
  }
  if (kindHint === 'media') {
    if (over(l.mediaUploadsPerMonth, u.mediaUploadsThisMonth)) {
      throw new LimitError('limit_reached', 'media_uploads', l.mediaUploadsPerMonth!, u.mediaUploadsThisMonth, e.tier);
    }
    if (over(l.mediaMinutesPerMonth, u.mediaMinutesThisMonth)) {
      throw new LimitError('limit_reached', 'media_minutes', l.mediaMinutesPerMonth!, u.mediaMinutesThisMonth, e.tier, 1);
    }
  }
}

export type MaterialReservation = { minutes: number; minutesLedgerId: string | null; allowance?: LectureAllowance; partial?: boolean };

/**
 * Authoritative check + reservation for a new material, inside the transaction that inserts it
 * (so a refused upload leaves no material and no usage). PDFs use the PDF-upload allowance;
 * audio/video use one lecture upload plus their length in minutes (rounded up).
 */
export async function reserveMaterialUpload(tx: Tx, userId: string, kind: 'pdf' | 'audio' | 'video', durationSeconds: number | null): Promise<MaterialReservation> {
  await lockUsage(tx, userId);
  const e = await getEntitlement(userId, tx);
  const { limits: l, usage: u } = e;
  if (kind === 'pdf') {
    if (over(l.courseUploadsPerMonth, u.courseUploadsThisMonth)) {
      throw new LimitError('limit_reached', 'course_uploads', l.courseUploadsPerMonth!, u.courseUploadsThisMonth, e.tier);
    }
    await tx.insert(usageLedger).values({ userId, kind: 'course_upload', amount: 1 });
    return { minutes: 0, minutesLedgerId: null };
  }
  assertLectures(e);
  if (over(l.mediaUploadsPerMonth, u.mediaUploadsThisMonth)) {
    throw new LimitError('limit_reached', 'media_uploads', l.mediaUploadsPerMonth!, u.mediaUploadsThisMonth, e.tier);
  }
  const { minutes, partial } = minutesToReserve(e, minutesFor(durationSeconds ?? 0));
  await tx.insert(usageLedger).values({ userId, kind: 'media_upload', amount: 1 });
  const [row] = await tx.insert(usageLedger).values({ userId, kind: 'media_minutes', amount: minutes }).returning({ id: usageLedger.id });
  return { minutes, minutesLedgerId: row.id, allowance: e.lectureAllowance, partial };
}

/**
 * Minutes to reserve for a lecture of `requested` minutes.
 *   Free's one lecture and the trial's lecture: a longer recording isn't refused — only its first
 *   part is processed, up to the allowance left (45 min). The transcription provider is told to stop
 *   there (`maxSeconds` → `audio_end_at`), so nothing beyond it is ever transcribed or charged.
 *   Paid plans: the per-file maximum and monthly minutes apply as before (402 media_length / media_minutes).
 */
export function minutesToReserve(e: Entitlement, requested: number): { minutes: number; partial: boolean } {
  const { limits: l, usage: u } = e;
  if (e.lectureAllowance === 'once' || e.lectureAllowance === 'trial') {
    const left = l.mediaMinutesPerMonth === null ? Infinity : l.mediaMinutesPerMonth - u.mediaMinutesThisMonth;
    const cap = Math.min(l.maxMediaMinutesPerFile, left);
    if (cap <= 0) throw new LimitError('limit_reached', 'media_minutes', l.mediaMinutesPerMonth ?? 0, u.mediaMinutesThisMonth, e.tier, requested);
    return requested > cap ? { minutes: cap, partial: true } : { minutes: requested, partial: false };
  }
  checkMedia(e, requested);
  return { minutes: requested, partial: false };
}

/** Retrying a failed transcription reserves its minutes again (they were released on failure). */
export async function reserveMediaMinutes(userId: string, durationSeconds: number): Promise<MaterialReservation> {
  return db.transaction(async (tx) => {
    await lockUsage(tx, userId);
    const e = await getEntitlement(userId, tx);
    assertLectures(e); // e.g. downgraded to Basic since the upload failed
    const { minutes, partial } = minutesToReserve(e, minutesFor(durationSeconds));
    const [row] = await tx.insert(usageLedger).values({ userId, kind: 'media_minutes', amount: minutes }).returning({ id: usageLedger.id });
    return { minutes, minutesLedgerId: row.id, partial };
  });
}

/** Charges what was actually transcribed (never more than reserved). */
export async function settleMediaMinutes(ledgerId: string, reserved: number, actualSeconds: number): Promise<number> {
  const minutes = Math.min(reserved, minutesFor(actualSeconds));
  if (minutes !== reserved) await db.update(usageLedger).set({ amount: minutes }).where(eq(usageLedger.id, ledgerId));
  return minutes;
}

/** Transcription failed (nothing billed to us / delivered): give the minutes back. */
export async function releaseMediaMinutes(ledgerId: string): Promise<void> {
  await db.delete(usageLedger).where(eq(usageLedger.id, ledgerId));
}

/** After success: practice sets are charged for the questions actually generated (never more than reserved). */
export async function settleReservation(r: Reservation, actualAmount = r.amount): Promise<void> {
  const amount = Math.max(0, Math.min(r.amount, actualAmount));
  if (amount !== r.amount) await db.update(usageLedger).set({ amount }).where(eq(usageLedger.id, r.id));
}

/** After a failed generation (nothing was delivered): give the reservation back. */
export async function releaseReservation(r: Reservation): Promise<void> {
  await db.delete(usageLedger).where(eq(usageLedger.id, r.id));
}

export type { Limits };
