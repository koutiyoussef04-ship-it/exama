/**
 * Lecture audio/video (and extra PDFs) added to a course, through the HTTP API with the mock AI and
 * the deterministic mock transcription provider (no network, no cost):
 * validation, auth/ownership, plan limits for every tier + owner, state transitions, retry, failures,
 * timeouts, deletion (material, course mid-processing, account), course integration (topics, exams,
 * planner), storage lifecycle, analytics and burst limits.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import type { AuthResponse, CourseMaterial, CourseMaterialDetail, DocumentDetail, Entitlement, Exam, LimitErrorBody, StudyPlan } from '@study/shared';

const RUN = Date.now();
const OWNER_EMAIL = `materials-owner-${RUN}@example.com`;
Object.assign(process.env, {
  AI_PROVIDER: 'mock',
  TRANSCRIPTION_PROVIDER: 'mock',
  BILLING_MOCK_ENABLED: 'true',
  OWNER_EMAILS: OWNER_EMAIL,
  MEDIA_MAX_UPLOAD_MB: '1',
  MEDIA_TRANSCRIPTION_TIMEOUT_SECONDS: '1',
  MEDIA_UPLOADS_PER_HOUR: '12',
  MEDIA_MAX_ACTIVE_PER_USER: '2',
});
delete process.env.PLAN_LIMITS_OVERRIDE;

const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { config } = await import('../src/config.js');
const { flushAnalytics } = await import('../src/analytics/index.js');
const { studyAI, AIError } = await import('../src/ai/index.js');
const { materialJobs, purgeExpiredMedia } = await import('../src/services/materials/index.js');
const { addDays, localDate } = await import('../src/services/planner/dates.js');

after(async () => {
  await materialJobs.idle();
  await sql.end();
});

const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));
const fixture = (name: string) => readFile(new URL(`./fixtures/media/${name}`, import.meta.url));
const storagePath = (key: string) => join(resolve(config.STORAGE_DIR), key);

async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
const send = (method: string, body: unknown, token?: string) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, token });

let n = 0;
/** Lectures are a Student/Pro/trial feature: test users are on Student unless a test says otherwise. */
async function newUser(email = `materials-${RUN}-${n++}@example.com`, plan: string | null = 'student_monthly') {
  const r = await call<AuthResponse>('/auth/register', send('POST', { email, password: 'password123', name: 'Lecturer' }));
  assert.equal(r.status, 201);
  if (plan) assert.equal((await purchase(r.body.token, plan)).status, 200);
  return { token: r.body.token, id: r.body.user.id, email };
}
async function readyCourse(token: string): Promise<DocumentDetail> {
  const form = new FormData();
  form.append('file', new File([pdf], 'notes.pdf', { type: 'application/pdf' }));
  const up = await call<DocumentDetail>('/documents', { method: 'POST', body: form, token });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  for (let i = 0; i < 60; i++) {
    const d = await call<DocumentDetail>(`/documents/${up.body.id}`, { token });
    if (d.body.status === 'ready') return d.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('course not ready');
}

/** Minimal valid WAV: 40 bytes/s, so long lectures stay tiny. Optional mock-provider marker in the audio. */
function wav(minutes: number, marker = ''): Uint8Array {
  const rate = 40;
  const data = Math.round(minutes * 60 * rate);
  const b = Buffer.alloc(44 + data, 0x80);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVEfmt ', 8, 'latin1');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(data, 40);
  if (marker) b.write(marker, 44, 'latin1');
  return new Uint8Array(b);
}

type Res = CourseMaterial & LimitErrorBody & { code?: string; details?: { maxMb?: number } };
const upload = (token: string | undefined, docId: string, bytes: Uint8Array, opts: { type?: string; title?: string; language?: string } = {}) =>
  call<Res>(`/documents/${docId}/materials`, {
    method: 'POST',
    body: bytes as Uint8Array<ArrayBuffer>,
    token,
    headers: {
      'Content-Type': opts.type ?? 'audio/wav',
      'X-Exama-Title': encodeURIComponent(opts.title ?? 'Lecture 3 – enzymes.wav'),
      ...(opts.language ? { 'X-Exama-Language': opts.language } : {}),
    },
  });
const material = (token: string, docId: string, id: string) => call<CourseMaterialDetail & { code?: string }>(`/documents/${docId}/materials/${id}`, { token });
const status = async (token: string) => (await call<Entitlement>('/billing/status', { token })).body;
const setState = (token: string, state: string) => call<Entitlement>('/billing/mock/state', send('POST', { state }, token));
const purchase = (token: string, planId: string, startTrial = false) => call<Entitlement>('/billing/purchase', send('POST', { planId, startTrial }, token));
async function events(userId: string) {
  await flushAnalytics();
  return (await sql`select name, properties from analytics_events where user_id = ${userId} and name like 'material%' order by created_at`) as unknown as {
    name: string;
    properties: Record<string, unknown>;
  }[];
}
async function processed(token: string, docId: string, id: string) {
  await materialJobs.idle();
  return (await material(token, docId, id)).body;
}

// ---------------------------------------------------------------- happy path + integration

test('audio lecture: upload → transcribing → analyzing → ready; becomes part of the course', async () => {
  const { token, id: userId } = await newUser();
  const doc = await readyCourse(token);
  const before = doc.topics;

  const up = await upload(token, doc.id, wav(12));
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.deepEqual([up.body.kind, up.body.format, up.body.durationSeconds, up.body.primary, up.body.title], ['audio', 'wav', 720, false, 'Lecture 3 – enzymes']);
  assert.ok(['processing', 'transcribing', 'analyzing'].includes(up.body.status));

  const m = await processed(token, doc.id, up.body.id);
  assert.equal(m.status, 'ready', JSON.stringify(m));
  assert.equal(m.knowledge?.basis, 'transcript');
  assert.equal(m.sourceLanguage, 'en');
  assert.ok(m.newTopics.length >= 1, 'the lecture adds topics the PDF did not have');
  for (const t of m.knowledge!.topics) {
    assert.ok(t.sourceQuote.split(' ').length >= 4, 'every topic is grounded in a quote');
    assert.equal(typeof t.startSeconds, 'number', 'topics are located in the lecture');
  }

  // One coherent course: new topics merged after the PDF's, nothing lost.
  const course = (await call<DocumentDetail>(`/documents/${doc.id}`, { token })).body;
  assert.deepEqual(course.topics.slice(0, before.length), before);
  for (const t of m.newTopics) assert.ok(course.topics.includes(t));

  // Listed with the original PDF first.
  const list = (await call<CourseMaterial[]>(`/documents/${doc.id}/materials`, { token })).body;
  assert.deepEqual(list.map((x) => [x.primary, x.kind]), [[true, 'pdf'], [false, 'audio']]);

  // Transcript stored as timestamped chunks of the course; raw audio deleted.
  const chunks = await sql`select start_s, end_s, page_start from document_chunks where material_id = ${m.id} order by position`;
  assert.ok(chunks.length >= 1);
  assert.equal(chunks[0].start_s, 0);
  assert.ok(chunks.at(-1)!.end_s <= 720 && chunks.at(-1)!.end_s > 600);
  const [row] = await sql`select file_key, media_deleted_at, billed_minutes from course_materials where id = ${m.id}`;
  assert.equal(row.file_key, null);
  assert.ok(row.media_deleted_at);
  assert.equal(row.billed_minutes, 12);

  const s = await status(token);
  assert.deepEqual([s.usage.mediaUploadsThisMonth, s.usage.mediaMinutesThisMonth], [1, 12]);

  const ev = await events(userId);
  assert.deepEqual(
    ev.map((e) => e.name),
    ['material_processing_started', 'material_transcription_completed', 'material_processing_completed'],
  );
  assert.deepEqual([ev[1].properties.success, ev[1].properties.billed_minutes, ev[1].properties.provider], [true, 12, 'mock']);
  const raw = JSON.stringify(ev);
  assert.ok(!/fermentation|active site|pyruvate|Lecture 3/i.test(raw), 'no transcript text, knowledge or file names in analytics');
});

test('exams and practice use the lecture: questions on lecture-only topics, grounded in the transcript', async () => {
  const { token } = await newUser();
  const doc = await readyCourse(token);
  const up = await upload(token, doc.id, wav(10));
  const m = await processed(token, doc.id, up.body.id);
  assert.equal(m.status, 'ready');

  const course = (await call<DocumentDetail>(`/documents/${doc.id}`, { token })).body;
  const e = await call<Exam>(`/documents/${doc.id}/exams`, send('POST', { kind: 'standard', questionCount: 8 }, token));
  assert.equal(e.status, 201, JSON.stringify(e.body));
  const lectureTopics = new Set(m.newTopics);
  const onLecture = e.body.questions.filter((q) => lectureTopics.has(q.topic));
  assert.ok(onLecture.length >= 1, `exam covers lecture topics (${e.body.questions.map((q) => q.topic)} vs ${[...lectureTopics]})`);
  for (const q of e.body.questions) assert.ok(course.topics.includes(q.topic));
});

test('study planner: new lecture topics are offered, never forced; "update plan" schedules them', async () => {
  const { token } = await newUser();
  const doc = await readyCourse(token);
  const today = localDate(new Date(), 'UTC');
  const created = await call<StudyPlan>(`/documents/${doc.id}/study-plan`, send('POST', { examDate: addDays(today, 12), minutesPerDay: 120, preparedLevel: 'familiar', timezone: 'UTC' }, token));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.ok(!created.body.notices.includes('new_material'));
  const taskIds = created.body.tasks.map((t) => t.id).sort();

  const up = await upload(token, doc.id, wav(8));
  const m = await processed(token, doc.id, up.body.id);
  assert.equal(m.status, 'ready');

  const plan = (await call<StudyPlan>(`/documents/${doc.id}/study-plan`, { token })).body;
  assert.ok(plan.notices.includes('new_material'), 'the plan says new material is available');
  assert.deepEqual(plan.tasks.map((t) => t.id).sort(), taskIds, 'existing plan untouched');

  const updated = (await call<StudyPlan>(`/documents/${doc.id}/study-plan/recalculate`, send('POST', {}, token))).body;
  assert.ok(!updated.notices.includes('new_material'));
  const scheduled = new Set([...updated.tasks.map((t) => t.topic), ...updated.uncoveredTopics]);
  for (const t of m.newTopics) assert.ok(scheduled.has(t), `${t} is planned`);
});

test('video and other formats: mp4, mov, m4a, mp3 accepted by content; extra PDF uses the PDF allowance', async () => {
  const { token } = await newUser();
  await purchase(token, 'student_monthly');
  const doc = await readyCourse(token);
  const cases: [string, string, string, string][] = [
    ['lecture.mp4', 'video/mp4', 'video', 'mp4'],
    ['lecture.mov', 'video/quicktime', 'video', 'mov'],
    ['lecture.m4a', 'audio/x-m4a', 'audio', 'm4a'],
    ['lecture.mp3', 'audio/mpeg', 'audio', 'mp3'],
  ];
  for (const [file, type, kind, format] of cases) {
    const up = await upload(token, doc.id, new Uint8Array(await fixture(file)), { type, title: file });
    assert.equal(up.status, 201, `${file}: ${JSON.stringify(up.body)}`);
    assert.deepEqual([up.body.kind, up.body.format], [kind, format], file);
    assert.ok(up.body.durationSeconds! >= 3 && up.body.durationSeconds! <= 6, `${file} duration ${up.body.durationSeconds}`);
    const m = await processed(token, doc.id, up.body.id);
    assert.equal(m.status, 'ready', file);
  }
  // Declared type is ignored: a WAV labelled as video/mp4 is still a WAV.
  const lying = await upload(token, doc.id, wav(1), { type: 'video/mp4' });
  assert.deepEqual([lying.body.kind, lying.body.format], ['audio', 'wav']);
  await materialJobs.idle();

  const uploadsBefore = (await status(token)).usage.courseUploadsThisMonth;
  const extra = await upload(token, doc.id, new Uint8Array(pdf), { type: 'application/pdf', title: 'week2.pdf' });
  assert.equal(extra.status, 201, JSON.stringify(extra.body));
  assert.deepEqual([extra.body.kind, extra.body.format, extra.body.durationSeconds], ['pdf', 'pdf', null]);
  const m = await processed(token, doc.id, extra.body.id);
  assert.deepEqual([m.status, m.pageCount, m.knowledge?.basis], ['ready', 3, 'text']);
  assert.equal((await status(token)).usage.courseUploadsThisMonth, uploadsBefore + 1, 'extra PDFs count as PDF uploads');
});

test('multilingual: notes follow the study language; a French lecture is detected as French', async () => {
  const { token } = await newUser();
  const doc = await readyCourse(token);
  const up = await upload(token, doc.id, wav(5, 'EXAMA-MOCK:LANG=fr'), { language: 'es' });
  const m = await processed(token, doc.id, up.body.id);
  assert.equal(m.status, 'ready', JSON.stringify(m));
  assert.deepEqual([m.sourceLanguage, m.language], ['fr', 'es']);
  assert.ok(m.knowledge!.topics.every((t) => t.keyPoints.every((k) => k.startsWith('[mock:es]'))), 'notes in Spanish');
  assert.ok(m.knowledge!.topics.every((t) => /[àâçéèêëîïôûùü’]|fermentation|enzymes/i.test(t.sourceQuote)), 'quotes stay in the original French');
});

// ---------------------------------------------------------------- validation

test('validation: unsupported, corrupt, silent, empty and oversized files are refused with clear codes', async () => {
  const { token, id: userId } = await newUser();
  await purchase(token, 'pro_monthly');
  const doc = await readyCourse(token);
  const check = async (bytes: Uint8Array, expected: [number, string], type = 'audio/mpeg') => {
    const r = await upload(token, doc.id, bytes, { type });
    assert.deepEqual([r.status, r.body.code], expected, JSON.stringify(r.body));
  };
  await check(new Uint8Array(await fixture('random.bin')), [415, 'unsupported_format']);
  await check(new Uint8Array(await fixture('video-no-audio.mp4')), [422, 'media_no_audio'], 'video/mp4');
  await check((await fixture('lecture.mp4')).subarray(0, 300), [422, 'media_unreadable'], 'video/mp4');
  await check(new Uint8Array(0), [400, 'file_missing']);
  const big = await upload(token, doc.id, wav(500), {}); // 1.2 MB > MEDIA_MAX_UPLOAD_MB=1
  assert.deepEqual([big.status, big.body.code, big.body.details?.maxMb], [413, 'file_too_large', 1]);
  // Nothing was stored or charged for refused files.
  assert.equal((await sql`select count(*)::int as n from course_materials where user_id = ${userId}`)[0].n, 0);
  assert.equal((await status(token)).usage.mediaUploadsThisMonth, 0);
  assert.equal((await events(userId)).length, 0);
});

test('auth and ownership: sign-in required; other students’ courses and materials are invisible', async () => {
  const a = await newUser();
  const b = await newUser();
  const doc = await readyCourse(a.token);
  const up = await upload(a.token, doc.id, wav(2));
  assert.equal(up.status, 201);
  await materialJobs.idle();

  assert.equal((await upload(undefined, doc.id, wav(2))).status, 401);
  assert.equal((await call(`/documents/${doc.id}/materials`)).status, 401);
  assert.equal((await upload(b.token, doc.id, wav(2))).status, 404);
  assert.equal((await call(`/documents/${doc.id}/materials`, { token: b.token })).status, 404);
  assert.equal((await material(b.token, doc.id, up.body.id)).status, 404);
  assert.equal((await call(`/documents/${doc.id}/materials/${up.body.id}/retry`, send('POST', {}, b.token))).status, 404);
  assert.equal((await call(`/documents/${doc.id}/materials/${up.body.id}`, { method: 'DELETE', token: b.token })).status, 404);
  // B's own course + A's material id: still not found.
  const docB = await readyCourse(b.token);
  assert.equal((await material(b.token, docB.id, up.body.id)).status, 404);
  assert.equal((await material(a.token, doc.id, 'not-a-uuid')).status, 404);

  // A course that is still processing can't take materials yet.
  await sql`update documents set status = 'processing' where id = ${doc.id}`;
  assert.deepEqual([(await upload(a.token, doc.id, wav(2))).status], [409]);
  await sql`update documents set status = 'ready' where id = ${doc.id}`;
});

// ---------------------------------------------------------------- limits

test('basic: no audio/video lectures (refused before any transcription); extra PDFs still work', async () => {
  for (const plan of ['basic_monthly', 'basic_yearly']) {
    const { token } = await newUser(undefined, plan);
    const doc = await readyCourse(token);
    const e = await status(token);
    assert.deepEqual([e.features.lectures, e.lectureAllowance, e.limits.mediaUploadsPerMonth, e.limits.mediaMinutesPerMonth], [false, 'none', 0, 0], String(plan));
    // Declared as audio: refused before the body is read. Declared as octet-stream: refused after sniffing.
    for (const type of ['audio/wav', 'application/octet-stream']) {
      const r = await upload(token, doc.id, wav(1), { type });
      assert.deepEqual([r.status, r.body.code, r.body.feature, r.body.tier], [402, 'premium_required', 'lectures', 'basic'], `${plan} ${type}`);
    }
    // The client can't lift its own plan.
    const forged = await call<Res>(`/documents/${doc.id}/materials`, {
      method: 'POST',
      body: wav(1) as Uint8Array<ArrayBuffer>,
      token,
      headers: { 'Content-Type': 'audio/wav', 'X-Exama-Limit': '999', 'X-Exama-Tier': 'pro', 'X-Exama-Features': 'lectures' },
    });
    assert.equal(forged.status, 402);
    assert.equal((await status(token)).usage.mediaUploadsThisMonth, 0, 'nothing reserved');
    assert.equal((await sql`select count(*)::int as n from course_materials where document_id = ${doc.id}`)[0].n, 0);
  }
  // Basic still adds PDFs to a course.
  const { token } = await newUser(undefined, 'basic_monthly');
  const doc = await readyCourse(token);
  assert.equal((await upload(token, doc.id, new Uint8Array(pdf), { type: 'application/pdf', title: 'extra.pdf' })).status, 201);
  await materialJobs.idle();
});

// ---------------------------------------------------------------- the Free plan's single lecture

test('free: exactly one lecture per account, up to 45 minutes, minutes reserved before processing', async () => {
  const { token, id: userId } = await newUser(undefined, null);
  const e = await status(token);
  assert.deepEqual(
    [e.tier, e.features.lectures, e.lectureAllowance, e.limits.mediaUploadsPerMonth, e.limits.mediaMinutesPerMonth, e.limits.maxMediaMinutesPerFile],
    ['free', true, 'once', 1, 45, 45],
  );
  const doc = await readyCourse(token);

  // Too long: refused before anything is stored, reserved or transcribed.
  const long = await upload(token, doc.id, wav(46));
  assert.deepEqual([long.status, long.body.code, long.body.feature, long.body.limit, long.body.requested, long.body.tier], [402, 'premium_required', 'media_length', 45, 46, 'free']);
  assert.match(long.body.error, /free lecture/);
  assert.deepEqual([(await status(token)).usage.mediaUploadsThisMonth, (await status(token)).usage.mediaMinutesThisMonth], [0, 0], 'nothing reserved');
  assert.equal((await sql`select count(*)::int as n from course_materials where user_id = ${userId}`)[0].n, 0);

  // Exactly 45 minutes: accepted; the lecture and its 45 minutes are reserved before processing starts.
  const ok = await upload(token, doc.id, wav(45));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  const reserved = await status(token);
  assert.deepEqual([reserved.usage.mediaUploadsThisMonth, reserved.usage.mediaMinutesThisMonth], [1, 45]);
  const m = await processed(token, doc.id, ok.body.id);
  assert.equal(m.status, 'ready');
  const started = (await events(userId)).find((x) => x.name === 'material_processing_started');
  assert.deepEqual([started?.properties.reserved_minutes, started?.properties.lecture_allowance], [45, 'once']);

  // Used up: a second lecture — even a 1-minute one — opens the Student paywall.
  const second = await upload(token, doc.id, wav(1));
  assert.deepEqual([second.status, second.body.code, second.body.feature, second.body.limit, second.body.used, second.body.tier], [402, 'limit_reached', 'media_uploads', 1, 1, 'free']);
  assert.match(second.body.error, /used your free lecture.*Student/);
  // PDFs still work for Free.
  assert.equal((await upload(token, doc.id, new Uint8Array(pdf), { type: 'application/pdf', title: 'more.pdf' })).status, 201);
  await materialJobs.idle();
});

test('free lecture cannot be bypassed: same file again, deleting the course, next month, parallel uploads, retries', async () => {
  const { token, id: userId } = await newUser(undefined, null);
  const doc = await readyCourse(token);
  const lecture = wav(20);
  assert.equal((await upload(token, doc.id, lecture)).status, 201);
  await materialJobs.idle();

  // Same lecture again.
  assert.equal((await upload(token, doc.id, lecture)).body.feature, 'media_uploads');
  // Delete the whole course (and its lecture), start a new one: still used.
  assert.equal((await call(`/documents/${doc.id}`, { method: 'DELETE', token })).status, 204);
  const doc2 = await readyCourse(token);
  assert.equal((await upload(token, doc2.id, lecture)).body.feature, 'media_uploads');
  // A month later: not a monthly allowance, still used.
  await sql`update usage_ledger set created_at = created_at - interval '40 days' where user_id = ${userId}`;
  const later = await status(token);
  assert.deepEqual([later.usage.mediaUploadsThisMonth, later.usage.mediaMinutesThisMonth, later.usage.examGenerationsThisMonth], [1, 20, 0], 'lecture usage is per account; other free counters are monthly');
  assert.equal((await upload(token, doc2.id, wav(5))).body.feature, 'media_uploads');
  // A former subscriber back on Free has used lectures already.
  const exSub = await newUser();
  const exDoc = await readyCourse(exSub.token);
  assert.equal((await upload(exSub.token, exDoc.id, wav(2))).status, 201);
  await materialJobs.idle();
  await setState(exSub.token, 'expired');
  assert.equal((await upload(exSub.token, exDoc.id, wav(2))).body.feature, 'media_uploads');

  // Parallel uploads from a fresh account: exactly one gets through.
  const racer = await newUser(undefined, null);
  const rDoc = await readyCourse(racer.token);
  const results = await Promise.all([1, 2, 3].map(() => upload(racer.token, rDoc.id, wav(10))));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 402, 402]);
  await materialJobs.idle();
  assert.deepEqual([(await status(racer.token)).usage.mediaUploadsThisMonth, (await status(racer.token)).usage.mediaMinutesThisMonth], [1, 10]);

  // Retries: an outage keeps the upload counted and gives the minutes back; retrying the SAME
  // lecture works (minutes reserved again), but it never becomes a second lecture.
  const r2 = await newUser(undefined, null);
  const d2 = await readyCourse(r2.token);
  const failing = await upload(r2.token, d2.id, wav(30, 'EXAMA-MOCK:FAIL'));
  let m = await processed(r2.token, d2.id, failing.body.id);
  assert.deepEqual([m.status, m.canRetry], ['failed', true]);
  assert.deepEqual([(await status(r2.token)).usage.mediaUploadsThisMonth, (await status(r2.token)).usage.mediaMinutesThisMonth], [1, 0]);
  assert.equal((await upload(r2.token, d2.id, wav(30))).body.feature, 'media_uploads', 'a failed free lecture is still the free lecture');
  const [row] = await sql`select file_key from course_materials where id = ${m.id}`;
  await writeFile(storagePath(row.file_key), wav(30));
  assert.equal((await call(`/documents/${d2.id}/materials/${m.id}/retry`, send('POST', {}, r2.token))).status, 200);
  m = await processed(r2.token, d2.id, m.id);
  assert.equal(m.status, 'ready');
  assert.deepEqual([(await status(r2.token)).usage.mediaUploadsThisMonth, (await status(r2.token)).usage.mediaMinutesThisMonth], [1, 30]);
  assert.equal((await upload(r2.token, d2.id, wav(1))).body.feature, 'media_uploads');
});

test('free → Student: the monthly Student allowance replaces the single free lecture', async () => {
  const { token } = await newUser(undefined, null);
  const doc = await readyCourse(token);
  assert.equal((await upload(token, doc.id, wav(5))).status, 201);
  await materialJobs.idle();
  assert.equal((await upload(token, doc.id, wav(5))).body.feature, 'media_uploads');
  assert.equal((await purchase(token, 'student_monthly')).status, 200);
  const s = await status(token);
  assert.deepEqual([s.lectureAllowance, s.limits.mediaMinutesPerMonth, s.limits.maxMediaMinutesPerFile], ['monthly', 300, 120]);
  assert.equal((await upload(token, doc.id, wav(60))).status, 201);
  await materialJobs.idle();
});

test('downgrading Student → Basic stops new lectures; upgrading Basic → Student allows them', async () => {
  const { token } = await newUser(undefined, 'basic_monthly');
  const doc = await readyCourse(token);
  assert.equal((await upload(token, doc.id, wav(2))).body.feature, 'lectures');
  assert.equal((await purchase(token, 'student_yearly')).status, 200);
  assert.equal((await upload(token, doc.id, wav(2))).status, 201);
  await materialJobs.idle();
  assert.equal((await purchase(token, 'basic_yearly')).status, 200);
  assert.equal((await upload(token, doc.id, wav(2))).body.feature, 'lectures');
});

test('trial: one lecture of up to 30 minutes for the whole trial', async () => {
  const { token } = await newUser(undefined, null);
  await purchase(token, 'student_monthly', true);
  const doc = await readyCourse(token);
  const tooLong = await upload(token, doc.id, wav(31));
  assert.deepEqual([tooLong.status, tooLong.body.feature, tooLong.body.limit, tooLong.body.tier], [402, 'media_length', 30, 'trial']);
  assert.match(tooLong.body.error, /free trial/);
  assert.equal((await upload(token, doc.id, wav(30))).status, 201);
  await materialJobs.idle();
  const again = await upload(token, doc.id, wav(1));
  assert.deepEqual([again.status, again.body.feature, again.body.tier], [402, 'media_uploads', 'trial']);
});

test('student: lectures up to 120 minutes, 300 minutes per month (minutes are the cost cap)', async () => {
  const { token } = await newUser();
  await purchase(token, 'student_monthly');
  const doc = await readyCourse(token);
  assert.deepEqual([(await upload(token, doc.id, wav(121))).body.feature], ['media_length']);
  for (const minutes of [120, 120]) {
    assert.equal((await upload(token, doc.id, wav(minutes))).status, 201);
    await materialJobs.idle();
  }
  const over = await upload(token, doc.id, wav(61)); // 240 used + 61 > 300
  assert.deepEqual([over.status, over.body.feature, over.body.limit, over.body.used, over.body.requested], [402, 'media_minutes', 300, 240, 61]);
  assert.equal((await upload(token, doc.id, wav(60))).status, 201, 'exactly up to the cap is fine');
  await materialJobs.idle();
  assert.equal((await status(token)).usage.mediaMinutesThisMonth, 300);
  assert.equal((await upload(token, doc.id, wav(1))).body.feature, 'media_minutes');
});

test('pro: lectures up to 180 minutes, 720 per month; owner: no monthly caps, only the server-wide 240-minute file cap', async () => {
  const pro = await newUser(undefined, 'pro_yearly');
  const doc = await readyCourse(pro.token);
  assert.equal((await upload(pro.token, doc.id, wav(181))).body.feature, 'media_length');
  assert.equal((await upload(pro.token, doc.id, wav(180))).status, 201);
  await materialJobs.idle();
  const s = await status(pro.token);
  assert.deepEqual([s.limits.mediaMinutesPerMonth, s.limits.mediaUploadsPerMonth, s.usage.mediaMinutesThisMonth], [720, 80, 180]);

  const owner = await newUser(OWNER_EMAIL, null);
  const od = await readyCourse(owner.token);
  const os = await status(owner.token);
  assert.deepEqual([os.limits.mediaMinutesPerMonth, os.limits.mediaUploadsPerMonth, os.limits.maxMediaMinutesPerFile], [null, null, 240]);
  for (const minutes of [240, 240, 240]) {
    assert.equal((await upload(owner.token, od.id, wav(minutes))).status, 201, 'far beyond every plan’s monthly minutes');
    await materialJobs.idle();
  }
  assert.equal((await upload(owner.token, od.id, wav(241))).body.feature, 'media_length', 'hard safety cap still applies');
  assert.equal((await status(owner.token)).status, 'complimentary');
});

// ---------------------------------------------------------------- failures, retry, timeouts

test('transcription outage: failed + retryable, minutes given back, file kept; retry succeeds once fixed', async () => {
  const { token, id: userId } = await newUser();
  await purchase(token, 'student_monthly');
  const doc = await readyCourse(token);
  const up = await upload(token, doc.id, wav(20, 'EXAMA-MOCK:FAIL'));
  let m = await processed(token, doc.id, up.body.id);
  assert.deepEqual([m.status, m.errorCode, m.canRetry], ['failed', 'transcription_failed', true]);
  let s = await status(token);
  assert.deepEqual([s.usage.mediaUploadsThisMonth, s.usage.mediaMinutesThisMonth], [1, 0], 'upload counted, minutes released');
  const [row] = await sql`select file_key from course_materials where id = ${m.id}`;
  assert.ok(row.file_key && existsSync(storagePath(row.file_key)), 'kept for retry');

  // Provider still failing: attempts are limited.
  assert.equal((await call(`/documents/${doc.id}/materials/${m.id}/retry`, send('POST', {}, token))).status, 200);
  m = await processed(token, doc.id, m.id);
  assert.equal(m.status, 'failed');
  assert.equal((await status(token)).usage.mediaMinutesThisMonth, 0);

  // "Provider recovers" (the marker is gone): the last attempt succeeds and charges the minutes.
  await writeFile(storagePath(row.file_key), wav(20));
  assert.equal((await call(`/documents/${doc.id}/materials/${m.id}/retry`, send('POST', {}, token))).status, 200);
  m = await processed(token, doc.id, m.id);
  assert.equal(m.status, 'ready');
  s = await status(token);
  assert.deepEqual([s.usage.mediaUploadsThisMonth, s.usage.mediaMinutesThisMonth], [1, 20]);
  const r = await call<Res>(`/documents/${doc.id}/materials/${m.id}/retry`, send('POST', {}, token));
  assert.deepEqual([r.status, r.body.code], [409, 'material_not_failed']);

  const names = (await events(userId)).map((e) => e.name);
  assert.equal(names.filter((x) => x === 'material_processing_failed').length, 2);
  assert.equal(names.filter((x) => x === 'material_processing_started').length, 3);
});

test('retry limit: three attempts, then the student must upload again', async () => {
  const { token } = await newUser();
  await purchase(token, 'student_monthly');
  const doc = await readyCourse(token);
  const up = await upload(token, doc.id, wav(3, 'EXAMA-MOCK:FAIL'));
  await materialJobs.idle();
  for (let i = 0; i < 2; i++) {
    assert.equal((await call(`/documents/${doc.id}/materials/${up.body.id}/retry`, send('POST', {}, token))).status, 200);
    await materialJobs.idle();
  }
  const m = (await material(token, doc.id, up.body.id)).body;
  assert.deepEqual([m.status, m.canRetry], ['failed', false]);
  const r = await call<Res>(`/documents/${doc.id}/materials/${up.body.id}/retry`, send('POST', {}, token));
  assert.deepEqual([r.status, r.body.code], [409, 'retry_limit']);
});

test('no usable speech and timeouts: clear codes; silence is not retryable, a timeout is', async () => {
  const { token } = await newUser();
  await purchase(token, 'student_monthly');
  const doc = await readyCourse(token);
  const silent = await upload(token, doc.id, wav(4, 'EXAMA-MOCK:NO_SPEECH'));
  const hang = await upload(token, doc.id, wav(4, 'EXAMA-MOCK:HANG'));
  await materialJobs.idle();
  const a = (await material(token, doc.id, silent.body.id)).body;
  const b = (await material(token, doc.id, hang.body.id)).body;
  assert.deepEqual([a.status, a.errorCode, a.canRetry], ['failed', 'media_no_speech', false]);
  assert.deepEqual([b.status, b.errorCode, b.canRetry], ['failed', 'transcription_timeout', true]);
  assert.equal((await status(token)).usage.mediaMinutesThisMonth, 0);
});

test('AI extraction failure: transcript kept (not re-transcribed or re-charged), not used by exams until ready', async () => {
  const { token } = await newUser();
  await purchase(token, 'student_monthly');
  const doc = await readyCourse(token);
  const original = studyAI.extractKnowledge.bind(studyAI);
  studyAI.extractKnowledge = async () => {
    throw new AIError('unavailable', 'test outage');
  };
  let m: CourseMaterialDetail;
  try {
    const up = await upload(token, doc.id, wav(9));
    m = await processed(token, doc.id, up.body.id);
  } finally {
    studyAI.extractKnowledge = original;
  }
  assert.deepEqual([m.status, m.errorCode, m.canRetry], ['failed', 'ai_unavailable', true]);
  assert.equal((await status(token)).usage.mediaMinutesThisMonth, 9, 'transcription was done, so it stays charged');
  const chunks = await sql`select count(*)::int as n from document_chunks where material_id = ${m.id}`;
  assert.ok(chunks[0].n > 0, 'transcript kept for the retry');

  // Exams don't see a failed material's text.
  const e = await call<Exam>(`/documents/${doc.id}/exams`, send('POST', { kind: 'standard', questionCount: 6 }, token));
  assert.equal(e.status, 201);
  const quotes = await sql`select source_quote from questions where exam_id = ${e.body.id}`;
  assert.ok(quotes.length && quotes.every((q) => !/fermentation|active site|lactate/i.test(q.source_quote)));

  assert.equal((await call(`/documents/${doc.id}/materials/${m.id}/retry`, send('POST', {}, token))).status, 200);
  m = await processed(token, doc.id, m.id);
  assert.equal(m.status, 'ready');
  assert.equal((await status(token)).usage.mediaMinutesThisMonth, 9, 'no second transcription charge');
});

test('burst protection: too many at once (429 too_many_processing) and per-hour upload limit (429)', async () => {
  const { token } = await newUser();
  await purchase(token, 'pro_monthly');
  const doc = await readyCourse(token);
  const a = await upload(token, doc.id, wav(3, 'EXAMA-MOCK:HANG'));
  const b = await upload(token, doc.id, wav(3, 'EXAMA-MOCK:HANG'));
  const c = await upload(token, doc.id, wav(3));
  assert.deepEqual([a.status, b.status, c.status, c.body.code], [201, 201, 429, 'too_many_processing']);
  await materialJobs.idle();

  let last = 0;
  let code = '';
  for (let i = 0; i < 12 && last !== 429; i++) {
    const r = await upload(token, doc.id, new Uint8Array(await fixture('random.bin')));
    last = r.status;
    code = r.body.code ?? '';
  }
  assert.deepEqual([last, code], [429, 'too_many_requests']);
});

test('a course holds at most 30 added materials', async () => {
  const { token, id: userId } = await newUser();
  const doc = await readyCourse(token);
  await sql`insert into course_materials (document_id, user_id, kind, format, title, status, mime_type, size_bytes)
            select ${doc.id}, ${userId}, 'audio', 'wav', 'x', 'ready', 'audio/wav', 1 from generate_series(1, 30)`;
  const r = await upload(token, doc.id, wav(2));
  assert.deepEqual([r.status, r.body.code], [409, 'too_many_materials']);
  assert.equal((await status(token)).usage.mediaUploadsThisMonth, 0, 'refused upload is not charged');
});

// ---------------------------------------------------------------- deletion + storage lifecycle

test('removing a material removes its text and the topics only it added; usage is not refunded', async () => {
  const { token } = await newUser();
  const doc = await readyCourse(token);
  const up = await upload(token, doc.id, wav(6));
  const m = await processed(token, doc.id, up.body.id);
  assert.equal(m.status, 'ready');
  assert.equal((await call(`/documents/${doc.id}/materials/${m.id}`, { method: 'DELETE', token })).status, 204);
  assert.equal((await material(token, doc.id, m.id)).status, 404);
  assert.equal((await sql`select count(*)::int as n from document_chunks where material_id = ${m.id}`)[0].n, 0);
  const course = (await call<DocumentDetail>(`/documents/${doc.id}`, { token })).body;
  assert.deepEqual(course.topics, doc.topics, 'back to the PDF’s topics');
  assert.equal((await status(token)).usage.mediaUploadsThisMonth, 1);
  // Can't delete the course PDF through the materials API.
  assert.equal((await call(`/documents/${doc.id}/materials/${doc.id}`, { method: 'DELETE', token })).status, 404);
});

test('deleting the course while a lecture is processing stops the job and leaves nothing behind', async () => {
  const { token, id: userId } = await newUser();
  const doc = await readyCourse(token);
  const up = await upload(token, doc.id, wav(5, 'EXAMA-MOCK:HANG'));
  assert.equal(up.status, 201);
  const [row] = await sql`select file_key from course_materials where id = ${up.body.id}`;
  assert.equal((await call(`/documents/${doc.id}`, { method: 'DELETE', token })).status, 204);
  await materialJobs.idle();
  assert.equal((await sql`select count(*)::int as n from course_materials where user_id = ${userId}`)[0].n, 0);
  assert.ok(!existsSync(storagePath(row.file_key)), 'media file deleted');
  assert.ok(!(await events(userId)).some((e) => e.name === 'material_processing_failed'), 'not reported as a failure');
});

test('failed uploads keep their file only for the retention period', async () => {
  const { token } = await newUser();
  const doc = await readyCourse(token);
  const up = await upload(token, doc.id, wav(3, 'EXAMA-MOCK:FAIL'));
  await materialJobs.idle();
  const [row] = await sql`select file_key from course_materials where id = ${up.body.id}`;
  await sql`update course_materials set updated_at = now() - interval '8 days' where id = ${up.body.id}`;
  assert.ok((await purgeExpiredMedia()) >= 1);
  assert.ok(!existsSync(storagePath(row.file_key)));
  const m = (await material(token, doc.id, up.body.id)).body;
  assert.equal(m.canRetry, false, 'nothing left to retry — upload again');
  const r = await call<Res>(`/documents/${doc.id}/materials/${up.body.id}/retry`, send('POST', {}, token));
  assert.deepEqual([r.status, r.body.code], [409, 'media_expired']);
});

test('account deletion removes materials, transcripts and files', async () => {
  const u = await newUser();
  const doc = await readyCourse(u.token);
  const up = await upload(u.token, doc.id, wav(3, 'EXAMA-MOCK:FAIL'));
  await materialJobs.idle();
  const [row] = await sql`select file_key from course_materials where id = ${up.body.id}`;
  const r = await call('/auth/me', { method: 'DELETE', body: JSON.stringify({ password: 'password123' }), headers: { 'Content-Type': 'application/json' }, token: u.token });
  assert.equal(r.status, 200);
  assert.equal((await sql`select count(*)::int as n from course_materials where user_id = ${u.id}`)[0].n, 0);
  assert.ok(!existsSync(storagePath(row.file_key)));
});

test('client material events are accepted without content; unknown properties are rejected', async () => {
  const { token } = await newUser();
  const anonymousId = crypto.randomUUID();
  const docId = crypto.randomUUID();
  const ok = await call('/events', send('POST', {
    anonymousId,
    events: [
      { name: 'material_upload_started', properties: { platform: 'ios', document_id: docId, kind: 'video', file_size_kb: 51200 } },
      { name: 'material_upload_failed', properties: { platform: 'ios', document_id: docId, kind: 'audio', failure_reason: 'too_large' } },
      { name: 'material_opened', properties: { platform: 'web', document_id: docId, material_id: crypto.randomUUID(), kind: 'audio', status: 'ready' } },
    ],
  }, token));
  assert.equal(ok.status, 202);
  const bad = await call('/events', send('POST', { anonymousId, events: [{ name: 'material_upload_started', properties: { platform: 'ios', document_id: docId, kind: 'audio', file_name: 'Lecture 3.m4a' } }] }, token));
  assert.equal(bad.status, 400);
});
