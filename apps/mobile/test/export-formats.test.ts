/**
 * Export page: CSV, Moodle GIFT, Excel and PDF. The app reads the file as bytes (the CSV's byte-order mark survives,
 * binary formats download), shows the count and name the API sends, and for a PDF chooses the version before
 * exporting — student (no answers) by default. The server decides the content; the app never filters answers out.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { EXPORT_FORMATS, exportQuerySchema, isTextExportFormat, PDF_MODES } from '@study/shared';
import i18n, { initI18n } from '../src/i18n';

const src = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('formats and PDF modes: four formats; the PDF mode defaults to the student version on the server too', () => {
  assert.deepEqual([...EXPORT_FORMATS], ['csv', 'gift', 'xlsx', 'pdf']);
  assert.deepEqual([...PDF_MODES], ['student', 'teacher']);
  assert.deepEqual(EXPORT_FORMATS.map(isTextExportFormat), [true, true, false, false]);
  assert.equal(exportQuerySchema.parse({ format: 'pdf' }).mode, 'student', 'no mode given → student');
  assert.equal(exportQuerySchema.parse({ format: 'pdf', mode: 'teacher', language: 'ar' }).language, 'ar');
  assert.equal(exportQuerySchema.safeParse({ format: 'pdf', mode: 'answers' }).success, false);
  assert.equal(exportQuerySchema.safeParse({ format: 'docx' }).success, false);
});

test('the API client downloads the export as bytes and reads the count and file name from the exposed headers', () => {
  const api = src('lib/api.ts');
  const fn = api.slice(api.indexOf('orgExport: async'), api.indexOf('return { bytes:'));
  assert.match(fn, /mode\?: PdfMode; language\?: Language/);
  assert.ok(!fn.includes('res.text()'), 'never decoded as text (that dropped the UTF-8 byte-order mark)');
  assert.match(api, /bytes: new Uint8Array\(await res\.arrayBuffer\(\)\)/);
  assert.match(api, /res\.headers\.get\('x-exama-export-count'\)/);
  assert.match(api, /\/filename="\(\[\^"\]\+\)"\/\.exec\(disposition\)/);
});

test('Export page: PDF version switch (student first) shown only for PDF; copy only for text formats; Excel/PDF are web downloads', () => {
  const page = src('app/org/export.tsx');
  assert.match(page, /useState<PdfMode>\('student'\)/, 'student by default');
  assert.match(page, /\{format === 'pdf' && \([\s\S]*?PDF_MODES\.map[\s\S]*?t\(`org\.export\.pdfModeHint\.\$\{pdfMode\}`\)/, 'the version control and its explanation, before the Export button');
  assert.ok(page.indexOf("format === 'pdf' && (") < page.indexOf("t('org.export.button')"), 'the version is chosen above the Export button');
  assert.match(page, /\.\.\.\(format === 'pdf' \? \{ mode: pdfMode, language: appLanguage \} : \{\}\)/, 'mode and language sent for PDF only');
  assert.match(page, /new g\.Blob\(\[bytes as BlobPart\], \{ type: contentType \}\)/, 'the download keeps the bytes as sent');
  assert.match(page, /const unavailableHere = !web && !textFormat;/);
  assert.match(page, /disabled=\{unavailableHere \|\| /);
  assert.match(page, /\{isTextExportFormat\(result\.format\) && <SmallButton title=\{t\('org\.export\.copy'\)\}/);
  assert.match(page, /\{!web && isTextExportFormat\(result\.format\) && \(/, 'the copyable text box only for text formats');
  assert.ok(!/correctAnswer|explanation/.test(page), 'the page never touches answers: the server builds each version');
});

test('export strings exist in every language and read correctly', async () => {
  const expectStudent = { en: 'Student version', es: 'Versión para estudiantes', fr: 'Version étudiants', ar: 'نسخة الطلاب' } as const;
  for (const [lang, student] of Object.entries(expectStudent)) {
    await initI18n(lang as 'en');
    for (const f of EXPORT_FORMATS) assert.ok(!i18n.t(`org.export.formats.${f}`).includes('org.export'), `${lang}: ${f}`);
    assert.equal(i18n.t('org.export.pdfModes.student'), student);
    for (const key of ['org.export.pdfMode', 'org.export.pdfModes.teacher', 'org.export.pdfModeHint.student', 'org.export.pdfModeHint.teacher', 'org.export.webOnly', 'org.ws.export.subtitle'] as const) {
      assert.ok(!String(i18n.t(key)).includes('org.'), `${lang}: ${key}`);
    }
    assert.match(i18n.t('org.export.formats.xlsx'), /Excel/);
    assert.match(i18n.t('org.ws.export.subtitle'), /Excel/);
    assert.equal(i18n.t('org.export.done', { count: 1, filename: 'exama-questions-2026-10-23.csv' }).includes('exama-questions-2026-10-23.csv'), true);
  }
  await initI18n('en');
});
