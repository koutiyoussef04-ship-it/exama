/**
 * PowerPoint (.pptx) support: text extraction (slide order, notes, tables, entities, safety limits)
 * and the product flows — a new course from a .pptx, and a .pptx added to an existing course.
 * Fixtures: lecture-slides.pptx (hand-built OOXML, slides stored out of display order, with notes),
 * cell-division.pptx (made with python-pptx from PowerPoint's default template: masters/layouts,
 * a table, notes), not-a-presentation.docx, legacy.ppt (OLE header), no-text.pptx.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { after, test } from 'node:test';
import type { AuthResponse, CourseMaterial, DocumentDetail, Exam } from '@study/shared';

Object.assign(process.env, { AI_PROVIDER: 'mock', TRANSCRIPTION_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'true' });
delete process.env.PLAN_LIMITS_OVERRIDE;
delete process.env.PLAN_FEATURES_OVERRIDE;
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const { materialJobs } = await import('../src/services/materials/index.js');
const pptx = await import('../src/lib/pptx.js');
const { probeMedia, bufferReader } = await import('../src/lib/media-probe.js');
const { PPTX_MIME } = await import('@study/shared');
after(async () => {
  await materialJobs.idle();
  await sql.end();
});

const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
const slides = async (name: string) => pptx.extractPptxSlides(pptx.bufferReader(await fixture(name)));

async function call<T>(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T & { code?: string } };
}
async function newUser(plan: string | null = null) {
  const r = await call<AuthResponse>('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `pptx-${crypto.randomUUID()}@example.com`, password: 'password123', name: 'Slides' }),
  });
  if (plan) {
    const p = await call('/billing/purchase', { method: 'POST', token: r.body.token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: plan }) });
    assert.equal(p.status, 200);
  }
  return r.body.token;
}
async function uploadCourse(token: string, bytes: Uint8Array, name: string, type = PPTX_MIME) {
  const form = new FormData();
  form.append('file', new File([bytes as Uint8Array<ArrayBuffer>], name, { type }));
  form.append('title', name);
  return call<DocumentDetail>('/documents', { method: 'POST', body: form, token });
}
async function settled(token: string, id: string): Promise<DocumentDetail> {
  for (let i = 0; i < 80; i++) {
    const d = await call<DocumentDetail>(`/documents/${id}`, { token });
    if (d.body.status !== 'processing') return d.body;
    await new Promise((r) => setTimeout(r, 75));
  }
  throw new Error('still processing');
}

test('extraction: presentation order (not file order), speaker notes, entities; masters and slide numbers ignored', async () => {
  const s = await slides('lecture-slides.pptx');
  assert.equal(s.length, 3);
  assert.deepEqual(
    s.map((x) => x.split('\n')[0]),
    ['Photosynthesis', 'Calvin cycle', 'Cellular respiration'],
    'order comes from ppt/presentation.xml, not slide file names',
  );
  assert.match(s[0], /chloroplasts of leaf cells & uses chlorophyll\./, 'runs joined, &amp; decoded');
  assert.match(s[0], /\n\nNotes: Remind students: oxygen released during photosynthesis comes from water\.$/);
  assert.ok(!/Notes:.*\b2\b\s*$/.test(s[0]), 'the notes page slide-number placeholder is dropped');

  const real = await slides('cell-division.pptx');
  assert.equal(real.length, 2);
  assert.match(real[0], /^Mitosis\nMitosis produces two identical daughter cells\./);
  assert.match(real[0], /Notes: Spend ten minutes on mitosis diagrams\./);
  assert.match(real[1], /Crossing over\nHappens in prophase I/, 'table cells are extracted');
  assert.ok(!real.join(' ').includes('Click to edit'), 'layout/master placeholder text is not slide content');
});

test('detection: only real presentations; Word ZIPs, legacy .ppt and broken files are refused', async () => {
  assert.equal(await pptx.isPptx(pptx.bufferReader(await fixture('lecture-slides.pptx'))), true);
  assert.equal(await pptx.isPptx(pptx.bufferReader(await fixture('not-a-presentation.docx'))), false);
  assert.equal(await pptx.isPptx(pptx.bufferReader(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]))), false, 'truncated ZIP');
  assert.equal(pptx.looksLikeOle(await fixture('legacy.ppt')), true);

  // Materials sniffing (bytes, never names): pptx is a document; docx and .ppt are refused.
  assert.deepEqual(await probeMedia(bufferReader(await fixture('lecture-slides.pptx'))), { format: 'pptx', kind: 'pdf', durationSeconds: null, hasVideo: false });
  await assert.rejects(probeMedia(bufferReader(await fixture('not-a-presentation.docx'))), (e: { code?: string }) => e.code === 'unsupported_format');
  await assert.rejects(probeMedia(bufferReader(await fixture('legacy.ppt'))), (e: { code?: string }) => e.code === 'ppt_legacy');

  // Truncating a real deck breaks its directory → unreadable, never a crash.
  const cut = (await fixture('cell-division.pptx')).subarray(0, 4000);
  await assert.rejects(pptx.extractPptxSlides(pptx.bufferReader(cut)), (e: { code?: string }) => e.code === 'pptx_unreadable');
});

test('safety: oversized (zip-bomb) and encrypted parts are refused', async () => {
  // A single 20 MB slide of zeros compresses to ~20 KB: refused by the per-part cap.
  const big = deflateRawSync(Buffer.alloc(20 * 1024 * 1024, 0x61));
  const zip = (name: string, data: Buffer, size: number, flags = 0) => {
    const nameB = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameB.length, 26);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameB.length, 28);
    cd.writeUInt32LE(0, 42);
    const body = Buffer.concat([local, nameB, data]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + nameB.length, 12);
    eocd.writeUInt32LE(body.length, 16);
    return new Uint8Array(Buffer.concat([body, cd, nameB, eocd]));
  };
  await assert.rejects(pptx.extractPptxSlides(pptx.bufferReader(zip('ppt/presentation.xml', big, 20 * 1024 * 1024))), (e: { code?: string }) => e.code === 'pptx_unreadable');
  // Lying about the size doesn't help: inflation itself is capped.
  await assert.rejects(pptx.extractPptxSlides(pptx.bufferReader(zip('ppt/presentation.xml', big, 100))), (e: { code?: string }) => e.code === 'pptx_unreadable');
  const small = deflateRawSync(Buffer.from('<p:presentation/>'));
  await assert.rejects(pptx.extractPptxSlides(pptx.bufferReader(zip('ppt/presentation.xml', small, 17, 0x1))), (e: { code?: string }) => e.code === 'pptx_unreadable', 'encrypted');
});

test('new course from a PowerPoint: processed like a PDF (slides = pages), exams grounded in the slides', async () => {
  const token = await newUser(); // Free plan: PowerPoint is not a paid feature
  const up = await uploadCourse(token, await fixture('lecture-slides.pptx'), 'Photosynthesis lecture.pptx');
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.title, 'Photosynthesis lecture');
  const doc = await settled(token, up.body.id);
  assert.equal(doc.status, 'ready', JSON.stringify(doc));
  assert.equal(doc.pageCount, 3, 'one page per slide');
  assert.ok(doc.topics.some((t) => /photosynthesis|calvin|respiration/i.test(t)), doc.topics.join());

  const [row] = await sql`select mime_type, file_key from documents where id = ${doc.id}`;
  assert.deepEqual([row.mime_type, String(row.file_key).endsWith('.pptx')], [PPTX_MIME, true]);
  const chunks = await sql`select content, page_start from document_chunks where document_id = ${doc.id} order by position`;
  assert.match(chunks.map((c) => c.content).join('\n'), /Calvin cycle uses ATP and NADPH/);

  const exam = await call<Exam>(`/documents/${doc.id}/exams`, { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'standard', questionCount: 4 }) });
  assert.equal(exam.status, 201, JSON.stringify(exam.body));
  assert.ok(exam.body.questions.length > 0);

  const materials = await call<CourseMaterial[]>(`/documents/${doc.id}/materials`, { token });
  assert.deepEqual([materials.body[0].primary, materials.body[0].kind, materials.body[0].format], [true, 'pdf', 'pptx']);
});

test('refused course files: legacy .ppt, Word documents, image-only slides', async () => {
  const token = await newUser();
  const legacy = await uploadCourse(token, await fixture('legacy.ppt'), 'old.ppt', 'application/vnd.ms-powerpoint');
  assert.deepEqual([legacy.status, legacy.body.code], [415, 'ppt_legacy']);
  const docx = await uploadCourse(token, await fixture('not-a-presentation.docx'), 'essay.docx', PPTX_MIME);
  assert.deepEqual([docx.status, docx.body.code], [415, 'not_pdf'], 'a mislabelled Word file is still refused');
  assert.equal((await call<{ usage: { courseUploadsThisMonth: number } }>('/billing/status', { token })).body.usage.courseUploadsThisMonth, 0, 'refused files cost nothing');

  const empty = await uploadCourse(token, await fixture('no-text.pptx'), 'pictures.pptx');
  assert.equal(empty.status, 201);
  const doc = await settled(token, empty.body.id);
  assert.deepEqual([doc.status, doc.errorCode], ['failed', 'pptx_no_text']);
});

test('a PowerPoint added to a course (Basic plan): part of the course, uses the document allowance', async () => {
  const token = await newUser('basic_monthly');
  const course = await uploadCourse(token, await fixture('lecture-slides.pptx'), 'Week 1.pptx');
  const doc = await settled(token, course.body.id);
  const add = await call<CourseMaterial>(`/documents/${doc.id}/materials`, {
    method: 'POST',
    token,
    body: (await fixture('cell-division.pptx')) as Uint8Array<ArrayBuffer>,
    headers: { 'Content-Type': PPTX_MIME, 'X-Exama-Title': encodeURIComponent('Week 2 – cell division.pptx') },
  });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  assert.deepEqual([add.body.kind, add.body.format, add.body.title], ['pdf', 'pptx', 'Week 2 – cell division']);
  await materialJobs.idle();
  const m = await call<CourseMaterial>(`/documents/${doc.id}/materials/${add.body.id}`, { token });
  assert.deepEqual([m.body.status, m.body.pageCount], ['ready', 2]);
  const s = await call<{ usage: { courseUploadsThisMonth: number; mediaUploadsThisMonth: number } }>('/billing/status', { token });
  assert.deepEqual([s.body.usage.courseUploadsThisMonth, s.body.usage.mediaUploadsThisMonth], [2, 0]);
});
