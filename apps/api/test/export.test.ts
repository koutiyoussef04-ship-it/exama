/**
 * Exports of approved questions: CSV, Moodle GIFT, Excel (.xlsx) and PDF (student / teacher). The web app reads the
 * file name and the question count from response headers, so they must be CORS-exposed (the "0 questions exported"
 * bug); every format contains approved questions only, honours the course/topic filters and the editor role.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import { after, test } from 'node:test';
import { extractText, getDocumentProxy } from 'unpdf';
import type { AuthResponse, BankItem, DocumentDetail, OrganizationCategory, User } from '@study/shared';
import { cellRef, xlsx, zip } from '../src/lib/xlsx.js';
import { isRtlText, prepareRtl, splitLtr } from '../src/services/bank/export-pdf.js';

const OWNER_EMAIL = `export-owner-${Date.now()}@example.com`;
Object.assign(process.env, { AI_PROVIDER: 'mock', BILLING_MOCK_ENABLED: 'true', OWNER_EMAILS: OWNER_EMAIL, CORS_ORIGINS: 'https://app.exama.app' });
const { app } = await import('../src/app.js');
const { sql } = await import('../src/db/client.js');
const PASSWORD = 'correct-horse-battery-staple';
const RUN = Date.now();
const ORIGIN = 'https://app.exama.app';
after(async () => {
  const ids = (await sql`select id from organizations where name like ${`Export % ${RUN}`}`) as unknown as { id: string }[];
  for (const { id } of ids) {
    await sql`delete from documents where organization_id = ${id}`;
    await sql`delete from organizations where id = ${id}`;
  }
  await sql.end();
});

let n = 0;
async function call(path: string, init: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = init;
  const res = await app.request(path, { ...rest, headers: { 'x-forwarded-for': `10.8.${++n % 250}.2`, ...(token && { Authorization: `Bearer ${token}` }), ...(rest.headers ?? {}) } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, bytes, text, headers: res.headers, body: (isJson && text ? JSON.parse(text) : null) as { code?: string; error?: string } | null };
}
const json = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const pdf = await readFile(new URL('./fixtures/biology-notes.pdf', import.meta.url));

type Account = { email: string; token: string; id: string; user: User };
async function signup(tag: string, extra: Record<string, unknown> = {}): Promise<Account> {
  const email = (extra.email as string | undefined) ?? `export-${tag}-${RUN}-${++n}@example.com`;
  const r = await call('/auth/register', json('POST', { email, password: PASSWORD, name: `Person ${tag}`, ageRange: '25_34', ...extra }));
  assert.equal(r.status, 201, r.text);
  const body = r.body as unknown as AuthResponse;
  return { email, token: body.token, id: body.user.id, user: body.user };
}
let ownerAccount: Promise<Account> | null = null;
const theOwner = () => (ownerAccount ??= signup('owner', { email: OWNER_EMAIL }));
/** An organization on a pilot (granted by the owner, as in production), with its first admin. */
async function orgSignup(tag: string, market: OrganizationCategory = 'training_center'): Promise<Account> {
  const a = await signup(tag, { accountType: 'organization', organizationName: `Export ${tag} ${RUN}`, market });
  const owner = await theOwner();
  const granted = await call(`/admin/organizations/${orgOf(a)}`, { ...json('PATCH', { plan: 'pilot' }), token: owner.token });
  assert.equal(granted.status, 200, granted.text);
  return a;
}
const staffSignup = (tag: string) => signup(tag, { accountType: 'organization' });
const orgOf = (a: Account) => a.user.organizations[0].id;

async function uploadCourse(token: string, orgId: string, name: string): Promise<DocumentDetail> {
  const form = new FormData();
  form.append('file', new File([pdf], name, { type: 'application/pdf' }));
  form.append('title', name.replace(/\.pdf$/, ''));
  const up = await call(`/orgs/${orgId}/courses`, { method: 'POST', body: form, token });
  assert.equal(up.status, 201, up.text);
  const id = (up.body as unknown as DocumentDetail).id;
  for (let i = 0; i < 100; i++) {
    const d = (await call(`/orgs/${orgId}/courses/${id}`, { token })).body as unknown as DocumentDetail;
    if (d.status === 'ready') return d;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('course not ready');
}
type Q = { documentId: string; topic: string; section?: string | null; stem: string; options: string[] | null; correctAnswer: string; explanation?: string; type?: 'mcq' | 'short_answer' };
async function addQuestion(token: string, orgId: string, q: Q, approve = true): Promise<BankItem> {
  const r = await call(`/orgs/${orgId}/items`, { ...json('POST', { type: q.options ? 'mcq' : 'short_answer', ...q }), token });
  assert.equal(r.status, 201, r.text);
  const item = r.body as unknown as BankItem;
  if (approve) assert.equal((await call(`/orgs/${orgId}/items/${item.id}/approve`, { ...json('POST', {}), token })).status, 200);
  return item;
}
const exportAs = (token: string | undefined, orgId: string, query: string, origin = ORIGIN) =>
  call(`/orgs/${orgId}/export?${query}`, { token, headers: { Origin: origin } });
const csvRows = (text: string) => text.replace(/^﻿/, '').split('\r\n').filter(Boolean);

// ---- a tiny ZIP reader (central directory → inflated parts), to check the workbook as a reader would
function unzip(buf: Uint8Array): Map<string, string> {
  const b = Buffer.from(buf);
  const eocd = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd > 0, 'end of central directory present');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const parts = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50, 'central directory entry');
    const method = b.readUInt16LE(p + 10);
    const packedSize = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const offset = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    assert.equal(b.readUInt32LE(offset), 0x04034b50, `local header of ${name}`);
    const lnameLen = b.readUInt16LE(offset + 26);
    const lextraLen = b.readUInt16LE(offset + 28);
    const data = b.subarray(offset + 30 + lnameLen + lextraLen, offset + 30 + lnameLen + lextraLen + packedSize);
    parts.set(name, (method === 8 ? inflateRawSync(data) : data).toString('utf8'));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return parts;
}
const cellTexts = (sheetXml: string) => [...sheetXml.matchAll(/<c r="([A-Z]+)(\d+)"[^>]*><is><t[^>]*>([^<]*)<\/t><\/is><\/c>/g)].map((m) => ({ col: m[1], row: Number(m[2]), text: m[3].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') }));

async function pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string; title: string }> {
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(doc, { mergePages: true });
  const meta = (await doc.getMetadata()) as { info?: { Title?: string } };
  return { pages: totalPages, text: text.replace(/\s+/g, ' '), title: meta.info?.Title ?? '' };
}
const reverse = (s: string) => [...s].reverse().join('');
/** pdf.js returns glyphs in visual order, so a right-to-left word may come back mirrored. */
const hasWord = (text: string, word: string) => text.includes(word) || text.includes(reverse(word));

// ================================================================================================================
test('the export response exposes its file name and count cross-origin, and the count is the number of exported rows (regression: "0 questions exported")', async () => {
  const admin = await orgSignup('count');
  const orgId = orgOf(admin);
  const course = await uploadCourse(admin.token, orgId, 'tutorat.pdf');
  await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'Réforme de la formation', stem: 'Quel est l’intitulé de la première séquence ?', options: ['La logique du référentiel', 'Les concepts', 'La relation tutorale', 'L’accompagnement'], correctAnswer: 'La logique du référentiel', explanation: 'La séquence 1.' });
  await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'Réforme de la formation', stem: 'Brouillon jamais approuvé', options: ['a', 'b'], correctAnswer: 'a' }, false);

  const csv = await exportAs(admin.token, orgId, 'format=csv');
  assert.equal(csv.status, 200);
  const exposed = (csv.headers.get('access-control-expose-headers') ?? '').toLowerCase();
  assert.ok(exposed.includes('content-disposition') && exposed.includes('x-exama-export-count'), `exposed: "${exposed}"`);
  assert.equal(csv.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(csv.headers.get('x-exama-export-count'), '1');
  assert.match(csv.headers.get('content-disposition') ?? '', /^attachment; filename="exama-questions-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(csv.headers.get('cache-control'), 'no-store');
  assert.ok(csv.text.startsWith('﻿'), 'UTF-8 byte-order mark, so Excel reads accents');
  const rows = csvRows(csv.text);
  assert.equal(rows.length, 2, 'header + exactly the one approved question');
  assert.equal(rows.length - 1, Number(csv.headers.get('x-exama-export-count')), 'the count the app shows equals the exported rows');
  assert.ok(rows[1].includes('"Quel est l’intitulé de la première séquence ?"'));
  assert.ok(!csv.text.includes('Brouillon jamais approuvé'), 'drafts are never exported');
  // The same for GIFT (same query, same count header).
  const gift = await exportAs(admin.token, orgId, 'format=gift');
  assert.equal(gift.headers.get('x-exama-export-count'), '1');
  assert.ok((gift.headers.get('access-control-expose-headers') ?? '').toLowerCase().includes('x-exama-export-count'));
  assert.match(gift.text, /::Quel est l’intitulé[\s\S]*=La logique du référentiel[\s\S]*~Les concepts[\s\S]*#La séquence 1\./, 'GIFT unchanged: title, correct (=), wrong (~), feedback (#)');
  assert.match(gift.headers.get('content-disposition') ?? '', /\.gift\.txt"$/);
});

test('empty and filtered selections: the count and the content follow the course/topic filter in every format', async () => {
  const admin = await orgSignup('filter');
  const orgId = orgOf(admin);
  const c1 = await uploadCourse(admin.token, orgId, 'course-one.pdf');
  const c2 = await uploadCourse(admin.token, orgId, 'course-two.pdf');
  await addQuestion(admin.token, orgId, { documentId: c1.id, topic: 'Alpha', stem: 'Q-alpha-one', options: ['x', 'y'], correctAnswer: 'x' });
  await addQuestion(admin.token, orgId, { documentId: c1.id, topic: 'Beta', stem: 'Q-beta-one', options: ['x', 'y'], correctAnswer: 'y' });
  await addQuestion(admin.token, orgId, { documentId: c2.id, topic: 'Alpha', stem: 'Q-alpha-two', options: ['x', 'y'], correctAnswer: 'x' });
  for (const format of ['csv', 'gift', 'xlsx', 'pdf'] as const) {
    const all = await exportAs(admin.token, orgId, `format=${format}`);
    assert.equal(all.headers.get('x-exama-export-count'), '3', format);
    const byCourse = await exportAs(admin.token, orgId, `format=${format}&documentId=${c1.id}`);
    assert.equal(byCourse.headers.get('x-exama-export-count'), '2', `${format} by course`);
    const byTopic = await exportAs(admin.token, orgId, `format=${format}&topic=Alpha`);
    assert.equal(byTopic.headers.get('x-exama-export-count'), '2', `${format} by topic`);
    const both = await exportAs(admin.token, orgId, `format=${format}&documentId=${c2.id}&topic=Alpha`);
    assert.equal(both.headers.get('x-exama-export-count'), '1', `${format} by course and topic`);
    const none = await exportAs(admin.token, orgId, `format=${format}&topic=Gamma`);
    assert.equal(none.status, 200, `${format} empty`);
    assert.equal(none.headers.get('x-exama-export-count'), '0', `${format} empty`);
    if (format === 'csv') {
      assert.equal(csvRows(none.text).length, 1, 'header only');
      assert.ok(!byCourse.text.includes('Q-alpha-two') && byCourse.text.includes('Q-beta-one'));
    }
    if (format === 'gift') assert.equal(none.text, '');
    if (format === 'xlsx') {
      const sheet = unzip(none.bytes).get('xl/worksheets/sheet1.xml')!;
      assert.equal(cellTexts(sheet).filter((c) => c.row > 1).length, 0, 'no data rows');
      const sheet2 = unzip(both.bytes).get('xl/worksheets/sheet1.xml')!;
      assert.deepEqual(cellTexts(sheet2).filter((c) => c.col === 'H' && c.row > 1).map((c) => c.text), ['Q-alpha-two']);
    }
    if (format === 'pdf') {
      const t = await pdfText(none.bytes);
      assert.ok(t.text.includes('No approved questions in this selection.'), t.text);
      const t2 = await pdfText(both.bytes);
      assert.ok(t2.text.includes('Q-alpha-two') && !t2.text.includes('Q-alpha-one'));
    }
  }
});

test('Excel: a valid workbook with the expected columns, one row per approved question, texts never evaluated as formulas', async () => {
  const admin = await orgSignup('xlsx');
  const orgId = orgOf(admin);
  const course = await uploadCourse(admin.token, orgId, 'cell-biology.pdf');
  await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'Photosynthèse', section: 'Module 1', stem: 'Où a lieu la photosynthèse « chez les plantes » ?', options: ['Chloroplastes', 'Mitochondries', 'Noyau', 'Ribosomes'], correctAnswer: 'Chloroplastes', explanation: 'Dans les chloroplastes des cellules foliaires.' });
  await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'Formules', stem: '=HYPERLINK("http://evil.example")', options: null, correctAnswer: '=1+1', explanation: '' });
  await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'عربي', stem: 'ما هو موقع التمثيل الضوئي؟', options: ['البلاستيدات', 'النواة'], correctAnswer: 'البلاستيدات' });

  const r = await exportAs(admin.token, orgId, 'format=xlsx');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.match(r.headers.get('content-disposition') ?? '', /filename="exama-questions-\d{4}-\d{2}-\d{2}\.xlsx"$/);
  assert.equal(r.headers.get('x-exama-export-count'), '3');
  assert.deepEqual([...r.bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'a ZIP container');
  const parts = unzip(r.bytes);
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']) assert.ok(parts.has(name), name);
  assert.match(parts.get('[Content_Types].xml')!, /spreadsheetml\.sheet\.main\+xml/);
  assert.match(parts.get('xl/workbook.xml')!, /<sheet name="Questions" sheetId="1" r:id="rId1"\/>/);
  const sheet = parts.get('xl/worksheets/sheet1.xml')!;
  const cells = cellTexts(sheet);
  const header = cells.filter((c) => c.row === 1).map((c) => c.text);
  assert.deepEqual(header, ['id', 'version', 'course', 'section', 'topic', 'type', 'difficulty', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'option_f', 'correct_answer', 'explanation', 'source', 'source_quote', 'law', 'publication', 'article', 'effective_date']);
  assert.equal(new Set(cells.filter((c) => c.row > 1).map((c) => c.row)).size, 3, 'one row per approved question');
  const row = (stem: string) => cells.filter((c) => c.row === cells.find((x) => x.col === 'H' && x.text === stem)!.row);
  const bio = row('Où a lieu la photosynthèse « chez les plantes » ?');
  assert.equal(bio.find((c) => c.col === 'C')?.text, 'cell-biology');
  assert.equal(bio.find((c) => c.col === 'D')?.text, 'Module 1');
  assert.equal(bio.find((c) => c.col === 'I')?.text, 'Chloroplastes');
  assert.equal(bio.find((c) => c.col === 'O')?.text, 'Chloroplastes');
  assert.equal(bio.find((c) => c.col === 'P')?.text, 'Dans les chloroplastes des cellules foliaires.');
  assert.equal(bio.find((c) => c.col === 'M'), undefined, 'empty option_e is an empty cell');
  const formula = row('=HYPERLINK("http://evil.example")');
  assert.ok(sheet.includes('<c r="H3" t="inlineStr"') || sheet.includes('t="inlineStr"'), 'inline strings');
  assert.ok(!/<f>/.test(sheet), 'no formula cells anywhere');
  assert.equal(formula.find((c) => c.col === 'O')?.text, '=1+1', 'kept as text');
  assert.equal(row('ما هو موقع التمثيل الضوئي؟').find((c) => c.col === 'I')?.text, 'البلاستيدات');
  assert.match(sheet, /<cols><col min="1" max="1" width="38" customWidth="1"\/>/, 'column widths');
  assert.match(sheet, /<pane ySplit="1"[^>]*state="frozen"\/>/, 'frozen header row');
  assert.match(parts.get('xl/styles.xml')!, /<font><b\/>/, 'bold header font');
  assert.ok(/<c r="A1" t="inlineStr" s="1">/.test(sheet) && /<c r="A2" t="inlineStr" s="2">/.test(sheet), 'header and body styles');
});

test('Excel writer: cell references, XML escaping and the ZIP container', () => {
  assert.deepEqual([cellRef(0, 1), cellRef(25, 1), cellRef(26, 2), cellRef(27, 3), cellRef(701, 1), cellRef(702, 1)], ['A1', 'Z1', 'AA2', 'AB3', 'ZZ1', 'AAA1']);
  const buf = xlsx({ sheetName: 'S', title: 'T', columns: [{ header: 'a<b', width: 10 }], rows: [['x & "y"\u0007\n']] , now: new Date('2026-10-23T10:00:00Z') });
  const parts = unzip(new Uint8Array(buf));
  assert.match(parts.get('xl/worksheets/sheet1.xml')!, /<t xml:space="preserve">a&lt;b<\/t>/);
  assert.match(parts.get('xl/worksheets/sheet1.xml')!, /<t xml:space="preserve">x &amp; &quot;y&quot;\n<\/t>/, 'control character dropped, line break kept');
  assert.match(parts.get('docProps/core.xml')!, /2026-10-23T10:00:00/);
  const z = zip([{ name: 'a.txt', data: Buffer.from('hello') }]);
  assert.equal(unzip(new Uint8Array(z)).get('a.txt'), 'hello');
});

test('PDF student version: questions and choices only — no correct answers, explanations or sources; teacher version adds a separate answer key', async () => {
  const admin = await orgSignup('pdf');
  const orgId = orgOf(admin);
  const course = await uploadCourse(admin.token, orgId, 'tutorat.pdf');
  await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'Réforme', stem: 'Quel est l’intitulé de la première séquence du programme ?', options: ['La logique du référentiel de formation', 'Les concepts fondamentaux', 'La relation tutorale', 'L’accompagnement de l’étudiant'], correctAnswer: 'La logique du référentiel de formation', explanation: 'EXPLICATION-UNIQUE-7731 : la séquence 1 comprend la réforme.' });
  // Exports are sorted by section, topic, then creation: 'Réforme' sorts before 'Tutorat', as in CSV and GIFT.
  await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'Tutorat', stem: 'Citez la durée minimale du tutorat.', options: null, correctAnswer: 'REPONSE-COURTE-9924', explanation: '' });

  const student = await exportAs(admin.token, orgId, 'format=pdf&language=fr');
  assert.equal(student.status, 200);
  assert.equal(student.headers.get('content-type'), 'application/pdf');
  assert.match(student.headers.get('content-disposition') ?? '', /filename="exama-questions-\d{4}-\d{2}-\d{2}-student\.pdf"$/, 'the default mode is the student version');
  assert.equal(student.headers.get('x-exama-export-count'), '2');
  assert.equal(new TextDecoder().decode(student.bytes.subarray(0, 5)), '%PDF-');
  const s = await pdfText(student.bytes);
  assert.ok(s.title.includes('Version étudiants'), s.title);
  assert.ok(s.text.includes('Questions d’examen') && s.text.includes('Version étudiants'));
  assert.ok(s.text.includes('1. Quel est l’intitulé de la première séquence du programme ?'), 'numbered question');
  for (const opt of ['A) La logique du référentiel de formation', 'B) Les concepts fondamentaux', 'C) La relation tutorale', 'D) L’accompagnement de l’étudiant']) assert.ok(s.text.includes(opt), opt);
  assert.ok(s.text.includes('2. Citez la durée minimale du tutorat.') && s.text.includes('Réponse :'), 'short answer: a blank line');
  for (const secret of ['EXPLICATION-UNIQUE-7731', 'REPONSE-COURTE-9924', 'Corrigé', 'Explication', 'Source', 'Réponse : A', 'Réponse: A']) assert.ok(!s.text.includes(secret), `student version must not contain "${secret}"`);
  assert.ok(!new TextDecoder('latin1').decode(student.bytes).includes('EXPLICATION-UNIQUE-7731'), 'not even in the raw bytes');
  assert.match(s.text, /Page 1 sur 1/);

  const teacher = await exportAs(admin.token, orgId, 'format=pdf&mode=teacher&language=fr');
  assert.match(teacher.headers.get('content-disposition') ?? '', /-teacher\.pdf"$/);
  const t = await pdfText(teacher.bytes);
  assert.equal(t.pages, 2, 'the answer key is on its own page');
  assert.ok(t.title.includes('Version enseignants'));
  assert.ok(t.text.includes('1. Quel est l’intitulé'), 'the same paper first');
  const key = t.text.slice(t.text.indexOf('Corrigé'));
  assert.ok(key.length > 0, 'an answer key section');
  assert.ok(key.includes('1. Réponse : A) La logique du référentiel de formation'), key);
  assert.ok(key.includes('Explication : EXPLICATION-UNIQUE-7731'), key);
  assert.ok(key.includes('2. Réponse : REPONSE-COURTE-9924'), key);
  assert.ok(key.includes('Source : tutorat') && key.includes('Thème : Réforme'), key);
  assert.ok(!t.text.slice(0, t.text.indexOf('Corrigé')).includes('EXPLICATION-UNIQUE-7731'), 'explanations only in the key, not in the paper');
  // An unknown mode is refused; the labels follow the language asked for.
  assert.equal((await exportAs(admin.token, orgId, 'format=pdf&mode=answers')).status, 400);
  const en = await pdfText((await exportAs(admin.token, orgId, 'format=pdf&mode=teacher')).bytes);
  assert.ok(en.text.includes('Answer key') && en.text.includes('Teacher version') && en.text.includes('Page 1 of 2'));
});

test('PDF: long questions and explanations flow across pages; French accents and Arabic come through', async () => {
  const admin = await orgSignup('long');
  const orgId = orgOf(admin);
  const course = await uploadCourse(admin.token, orgId, 'long.pdf');
  const sentence = 'La réforme de la formation des professions de santé a été présentée aux étudiants et aux tuteurs au début du programme. ';
  for (let i = 0; i < 12; i++) {
    await addQuestion(admin.token, orgId, { documentId: course.id, topic: `Thème ${i % 3}`, section: `Module ${1 + Math.floor(i / 6)}`, stem: `Question ${i + 1}. ${sentence.repeat(14)}FIN-${i + 1}`, options: [`Option A de la question ${i + 1} ${sentence.repeat(3)}`, 'Option B', 'Option C', 'Option D'], correctAnswer: 'Option C', explanation: `${sentence.repeat(12)}FIN-EXPLICATION-${i + 1}` });
  }
  await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'عربي', stem: 'ما هو عنوان التسلسل الأول من البرنامج؟', options: ['منطق مرجع التدريب', 'المفاهيم الأساسية'], correctAnswer: 'منطق مرجع التدريب', explanation: 'الشرح بالعربية.' });

  const s = await pdfText((await exportAs(admin.token, orgId, 'format=pdf&language=fr')).bytes);
  assert.ok(s.pages >= 5, `several pages (${s.pages})`);
  for (let i = 1; i <= 12; i++) assert.ok(s.text.includes(`FIN-${i}`), `question ${i} is complete`);
  assert.ok(s.text.includes('Module 1') && s.text.includes('Module 2'), 'section headings');
  assert.ok(s.text.includes(`Page ${s.pages} sur ${s.pages}`) && s.text.includes('Page 1 sur'), 'page numbers on every page');
  assert.ok(s.text.includes('présentée aux étudiants et aux tuteurs'), 'accents intact');
  assert.ok(hasWord(s.text, 'التدريب') && hasWord(s.text, 'البرنامج'), 'Arabic glyphs present');
  const t = await pdfText((await exportAs(admin.token, orgId, 'format=pdf&mode=teacher&language=fr')).bytes);
  for (let i = 1; i <= 12; i++) assert.ok(t.text.includes(`FIN-EXPLICATION-${i}`), `explanation ${i} is complete in the key`);
  assert.ok(t.pages > s.pages, 'the key adds pages');
});

test('PDF direction helpers: right-to-left detection, Latin segments inside Arabic lines, Arabic words inside Latin lines', () => {
  assert.equal(isRtlText('ما هو؟'), true);
  assert.equal(isRtlText('1. ما هو؟'), true, 'leading digits do not decide');
  assert.equal(isRtlText('Quel est… ؟'), false);
  assert.equal(isRtlText(''), false);
  assert.equal(prepareRtl('مستوى PDF في عام 2026 كان جيدًا (question 1).'), 'مستوى FDP في عام 6202 كان جيدًا )1 noitseuq(.', 'pre-reversed so the whole-line mirroring restores them');
  assert.equal(prepareRtl('نسبة 50% فقط'), 'نسبة %05 فقط');
  assert.deepEqual(splitLtr('Which term means التدريب or التعليم?'), [
    { text: 'Which term means ', rtl: false },
    { text: 'التدريب', rtl: true },
    { text: ' or ', rtl: false },
    { text: 'التعليم', rtl: true },
    { text: '?', rtl: false },
  ]);
  assert.deepEqual(splitLtr('Plain text'), [{ text: 'Plain text', rtl: false }]);
});

test('authorization: every format needs an editor of that organization; approval rules are the same for all', async () => {
  const admin = await orgSignup('auth');
  const orgId = orgOf(admin);
  const course = await uploadCourse(admin.token, orgId, 'auth.pdf');
  await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'T', stem: 'Approved question', options: ['a', 'b'], correctAnswer: 'a', explanation: 'SECRET-EXPLANATION' });
  const draft = await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'T', stem: 'Draft question', options: ['a', 'b'], correctAnswer: 'a' }, false);
  const rejected = await addQuestion(admin.token, orgId, { documentId: course.id, topic: 'T', stem: 'Rejected question', options: ['a', 'b'], correctAnswer: 'a' }, false);
  await call(`/orgs/${orgId}/items/${rejected.id}/reject`, { ...json('POST', {}), token: admin.token });
  const editor = await staffSignup('editor');
  const reviewer = await staffSignup('reviewer');
  const outsider = await staffSignup('outsider');
  await call(`/orgs/${orgId}/members`, { ...json('POST', { email: editor.email, role: 'editor' }), token: admin.token });
  await call(`/orgs/${orgId}/members`, { ...json('POST', { email: reviewer.email, role: 'reviewer' }), token: admin.token });
  const otherOrg = await orgSignup('other');
  const student = await signup('student');

  for (const format of ['csv', 'gift', 'xlsx', 'pdf&mode=teacher'] as const) {
    const q = `format=${format}`;
    assert.equal((await exportAs(editor.token, orgId, q)).status, 200, `${format}: editor`);
    assert.equal((await exportAs(admin.token, orgId, q)).status, 200, `${format}: admin`);
    const r = await exportAs(reviewer.token, orgId, q);
    assert.deepEqual([r.status, r.body?.code], [403, 'org_role_required'], `${format}: reviewer`);
    assert.equal((await exportAs(outsider.token, orgId, q)).status, 404, `${format}: not a member`);
    assert.equal((await exportAs(otherOrg.token, orgId, q)).status, 404, `${format}: another organization`);
    assert.equal((await exportAs(student.token, orgId, q)).status, 404, `${format}: a student`);
    assert.equal((await exportAs(undefined, orgId, q)).status, 401, `${format}: no session`);
    assert.equal((await exportAs(otherOrg.token, orgOf(otherOrg), `${q}&documentId=${course.id}`)).headers.get('x-exama-export-count'), '0', `${format}: a course of another organization exports nothing`);
    // Only the approved question, in every format.
    const ok = await exportAs(editor.token, orgId, q);
    assert.equal(ok.headers.get('x-exama-export-count'), '1', format);
    const content = format === 'xlsx' ? unzip(ok.bytes).get('xl/worksheets/sheet1.xml')! : format.startsWith('pdf') ? (await pdfText(ok.bytes)).text : ok.text;
    assert.ok(content.includes('Approved question'), format);
    assert.ok(!content.includes('Draft question') && !content.includes('Rejected question'), `${format}: drafts and rejected questions are never exported`);
  }
  // Reviewers cannot get the answers through the PDF either.
  assert.equal((await exportAs(reviewer.token, orgId, 'format=pdf&mode=teacher')).status, 403);
  assert.equal((await exportAs(reviewer.token, orgId, 'format=pdf')).status, 403);
  assert.equal((await exportAs(admin.token, orgId, 'format=docx')).status, 400, 'unknown format');
  void draft;
});
