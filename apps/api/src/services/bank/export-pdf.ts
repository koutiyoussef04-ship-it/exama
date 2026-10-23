/**
 * PDF export of approved questions (pdfkit, server side — the mode decides what goes into the file, so a student
 * paper never contains an answer the app would have to hide).
 *
 *   student  numbered questions and their answer choices; no correct answers, no explanations, no sources.
 *   teacher  the same question paper, then a separate "Answer key" section on a new page: each number with its
 *            correct answer, the explanation and the source reference.
 *
 * Text is set in DejaVu Sans (dejavu-fonts-ttf), embedded as a subset: it covers Latin with accents, Greek,
 * Cyrillic, Arabic and Hebrew, so questions keep their own script; pdfkit's built-in fonts only cover Western
 * Latin. Arabic paragraphs are shaped and laid out right-to-left (fontkit). Known limits: no CJK glyphs, and in an
 * Arabic sentence the spaces next to Latin words or numbers can be misplaced (no bidi algorithm in pdfkit).
 *
 * Long questions and explanations wrap and continue across pages; a question's number and first lines are kept
 * together; every page has "Page x of y" and the export date.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import PDFDocument from 'pdfkit';
import type { Language, PdfMode } from '@study/shared';

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONTS = { regular: join(FONT_DIR, 'DejaVuSans.ttf'), bold: join(FONT_DIR, 'DejaVuSans-Bold.ttf') };

/** What the PDF needs from an approved question (services/bank/export.ts maps its rows to this). */
export type PdfQuestion = {
  type: 'mcq' | 'short_answer';
  stem: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  topic: string;
  section: string | null;
  documentTitle: string;
  /** "Course, p. 12-13" (services/bank/export.ts sourceLabel). */
  sourceLabel: string;
};

export type PdfContext = {
  organization: string;
  /** The course the export was filtered to (its title), if any. */
  course: string | null;
  topic: string | null;
  mode: PdfMode;
  language: Language;
  now: Date;
};

/** Fixed labels of the paper, in the viewer's app language; questions keep the language they were written in. */
const LABELS: Record<Language, { colon: string; title: string; student: string; teacher: string; questions: string; answerKey: string; answer: string; explanation: string; source: string; course: string; topic: string; allCourses: string; answerLine: string; page: string; exported: string; none: string }> = {
  en: { colon: ': ', title: 'Exam questions', student: 'Student version', teacher: 'Teacher version', questions: 'questions', answerKey: 'Answer key', answer: 'Answer', explanation: 'Explanation', source: 'Source', course: 'Course', topic: 'Topic', allCourses: 'All courses', answerLine: 'Answer:', page: 'Page {{x}} of {{y}}', exported: 'Exported from Exama on {{date}}', none: 'No approved questions in this selection.' },
  es: { colon: ': ', title: 'Preguntas de examen', student: 'Versión para estudiantes', teacher: 'Versión para docentes', questions: 'preguntas', answerKey: 'Clave de respuestas', answer: 'Respuesta', explanation: 'Explicación', source: 'Fuente', course: 'Curso', topic: 'Tema', allCourses: 'Todos los cursos', answerLine: 'Respuesta:', page: 'Página {{x}} de {{y}}', exported: 'Exportado de Exama el {{date}}', none: 'No hay preguntas aprobadas en esta selección.' },
  fr: { colon: ' : ', title: 'Questions d’examen', student: 'Version étudiants', teacher: 'Version enseignants', questions: 'questions', answerKey: 'Corrigé', answer: 'Réponse', explanation: 'Explication', source: 'Source', course: 'Cours', topic: 'Thème', allCourses: 'Tous les cours', answerLine: 'Réponse :', page: 'Page {{x}} sur {{y}}', exported: 'Exporté d’Exama le {{date}}', none: 'Aucune question approuvée dans cette sélection.' },
  ar: { colon: ': ', title: 'أسئلة الاختبار', student: 'نسخة الطلاب', teacher: 'نسخة المعلمين', questions: 'أسئلة', answerKey: 'مفتاح الإجابات', answer: 'الإجابة', explanation: 'الشرح', source: 'المصدر', course: 'المقرر', topic: 'الموضوع', allCourses: 'كل المقررات', answerLine: 'الإجابة:', page: 'صفحة {{x}} من {{y}}', exported: 'صُدِّر من Exama في {{date}}', none: 'لا توجد أسئلة معتمدة في هذا التحديد.' },
};
const fill = (s: string, v: Record<string, string | number>) => s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(v[k] ?? ''));

/**
 * Direction. pdfkit has no bidi algorithm: fontkit detects one script per layout call and, for a right-to-left
 * script, reverses that whole glyph run; and without a `features` option pdfkit lays text out word by word.
 * Two cases are handled here (test/export.test.ts checks the extracted text):
 *  - a right-to-left paragraph (first strong character Arabic/Hebrew): laid out whole-line (`features: []`), so the
 *    line is mirrored as one unit with its spaces; Latin words and numbers inside are reversed beforehand so that
 *    the mirroring restores them ("2026", "PDF", "(question 1)");
 *  - a left-to-right paragraph with Arabic/Hebrew words: those words are drawn as their own continued runs, each
 *    mirrored by fontkit, in an otherwise ordinary line.
 * Not handled: a right-to-left paragraph that starts with a Latin word (fontkit then takes it for left-to-right).
 */
const RTL_CHAR = '\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufeff';
const RTL_FIRST = new RegExp(`^[^A-Za-z${RTL_CHAR}]*[${RTL_CHAR}]`);
export const isRtlText = (s: string) => RTL_FIRST.test(s);
const RTL_SEGMENT = new RegExp(`[${RTL_CHAR}][${RTL_CHAR}\\s.,;:!?؟،()«»"'-]*[${RTL_CHAR}]|[${RTL_CHAR}]`, 'g');
const LTR_SEGMENT = /[(«"']?[A-Za-z0-9\u00c0-\u024f][A-Za-z0-9\u00c0-\u024f\s.,;:!?()«»"'%/-]*[A-Za-z0-9\u00c0-\u024f%)»"']|[A-Za-z0-9\u00c0-\u024f]/g;
const reverse = (s: string) => [...s].reverse().join('');
/** The text as pdfkit should receive it for a right-to-left line: Latin/number segments pre-reversed. */
export const prepareRtl = (s: string) => s.replace(LTR_SEGMENT, reverse);
/** A left-to-right paragraph split into runs: plain text and right-to-left words (`rtl: true`). */
export function splitLtr(s: string): { text: string; rtl: boolean }[] {
  const out: { text: string; rtl: boolean }[] = [];
  let last = 0;
  for (const m of s.matchAll(RTL_SEGMENT)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), rtl: false });
    out.push({ text: m[0], rtl: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), rtl: false });
  return out;
}
const LETTERS = 'ABCDEFGH';

const PAGE = { size: 'A4' as const, margin: 56 };
const SIZE = { title: 18, subtitle: 10.5, heading: 13, body: 11, small: 9 };
const LABEL_WIDTH = 24;

export function renderPdf(questions: PdfQuestion[], ctx: PdfContext): Promise<Buffer> {
  const L = LABELS[ctx.language];
  const rtlUi = ctx.language === 'ar';
  const modeLabel = ctx.mode === 'teacher' ? L.teacher : L.student;
  const dateText = new Intl.DateTimeFormat(ctx.language === 'ar' ? 'ar-u-nu-latn' : ctx.language, { day: 'numeric', month: 'long', year: 'numeric' }).format(ctx.now);
  const scope = [`${L.course}${L.colon}${ctx.course ?? L.allCourses}`, ctx.topic ? `${L.topic}${L.colon}${ctx.topic}` : null].filter(Boolean).join(' · ');

  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    bufferPages: true,
    compress: true,
    info: { Title: `${L.title} — ${ctx.organization} — ${modeLabel}`, Author: 'Exama', Creator: 'Exama' },
    displayTitle: true,
    lang: ctx.language,
    pdfVersion: '1.5',
  });
  doc.registerFont('Sans', FONTS.regular);
  doc.registerFont('Sans-Bold', FONTS.bold);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - PAGE.margin * 2;
  const bottom = () => doc.page.height - PAGE.margin;
  const lineHeight = (size: number) => size * 1.35;
  /** Starts a new page when fewer than `lines` body lines fit, so a number is never left alone at the bottom. */
  const keep = (lines: number) => {
    if (doc.y + lines * lineHeight(SIZE.body) > bottom()) doc.addPage();
  };
  const rtlOf = (text: string) => isRtlText(text) || (rtlUi && !/[A-Za-z]/.test(text));
  /** One paragraph at (x, y) within `w`, right-to-left when its text is (see the note on direction above). */
  const write = (text: string, x: number, y: number, w: number, opts: { size?: number; bold?: boolean; gray?: boolean; align?: 'left' | 'right' } = {}) => {
    const size = opts.size ?? SIZE.body;
    const font = opts.bold ? 'Sans-Bold' : 'Sans';
    const color = opts.gray ? '#555555' : '#111111';
    const base = { width: w, lineGap: size * 0.25 };
    doc.font(font).fontSize(size).fillColor(color);
    if (rtlOf(text)) {
      doc.text(prepareRtl(text), x, y, { ...base, align: opts.align ?? 'right', features: [] });
      return;
    }
    const runs = splitLtr(text);
    runs.forEach((r, i) => {
      doc.font(font).fontSize(size).fillColor(color);
      const options = { ...base, align: opts.align ?? 'left', continued: i < runs.length - 1, ...(r.rtl ? { features: [] } : {}) };
      if (i === 0) doc.text(r.text, x, y, options);
      else doc.text(r.text, options);
    });
  };
  const paragraph = (text: string, opts: { size?: number; bold?: boolean; gray?: boolean; indent?: number } = {}) =>
    write(text, PAGE.margin + (opts.indent ?? 0), doc.y, width - (opts.indent ?? 0), opts);
  /**
   * A labelled line ("3." or "B)") with its text beside it. Left-to-right text: label at the left, text to its right.
   * Right-to-left text: label at the right edge, text to its left — both read from the label onward.
   */
  const labelled = (label: string, text: string, opts: { bold?: boolean; indent?: number } = {}) => {
    const indent = opts.indent ?? 0;
    const rtl = rtlOf(text);
    const y = doc.y;
    doc.font(opts.bold ? 'Sans-Bold' : 'Sans').fontSize(SIZE.body).fillColor('#111111');
    doc.text(label, rtl ? PAGE.margin + width - LABEL_WIDTH : PAGE.margin + indent, y, { width: LABEL_WIDTH, align: rtl ? 'right' : 'left', lineBreak: false });
    write(text, PAGE.margin + (rtl ? 0 : indent + LABEL_WIDTH), y, width - LABEL_WIDTH - indent, { bold: opts.bold });
  };
  const gap = (n = 1) => doc.moveDown(n);

  // ---- header
  write(L.title, PAGE.margin, doc.y, width, { size: SIZE.title, bold: true });
  write(`${ctx.organization} · ${modeLabel} · ${questions.length} ${L.questions}`, PAGE.margin, doc.y, width, { size: SIZE.subtitle, gray: true });
  write(scope, PAGE.margin, doc.y, width, { size: SIZE.subtitle, gray: true });
  doc.moveDown(0.5);
  doc.moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + width, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  gap(0.8);

  if (questions.length === 0) paragraph(L.none, { gray: true });

  // ---- question paper (both modes)
  let group: string | null = null;
  questions.forEach((q, i) => {
    const g = [q.documentTitle, q.section].filter(Boolean).join(' · ');
    if (g !== group) {
      keep(4);
      if (group !== null) gap(0.4);
      paragraph(g, { size: SIZE.heading, bold: true });
      gap(0.3);
      group = g;
    }
    keep(3);
    labelled(`${i + 1}.`, q.stem, { bold: true });
    gap(0.25);
    if (q.type === 'mcq') {
      q.options.forEach((o, k) => {
        keep(2);
        labelled(`${LETTERS[k] ?? String(k + 1)})`, o, { indent: LABEL_WIDTH });
      });
    } else {
      keep(2);
      paragraph(`${L.answerLine} ${'_'.repeat(48)}`, { indent: LABEL_WIDTH, gray: true });
    }
    gap(0.9);
  });

  // ---- answer key (teacher mode only): its own page, clearly separated from the paper
  if (ctx.mode === 'teacher' && questions.length > 0) {
    doc.addPage();
    write(L.answerKey, PAGE.margin, doc.y, width, { size: SIZE.title, bold: true });
    write(`${ctx.organization} · ${L.teacher}`, PAGE.margin, doc.y, width, { size: SIZE.subtitle, gray: true });
    doc.moveDown(0.5);
    doc.moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + width, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
    gap(0.8);
    questions.forEach((q, i) => {
      keep(3);
      const letter = q.type === 'mcq' ? LETTERS[q.options.indexOf(q.correctAnswer)] : undefined;
      labelled(`${i + 1}.`, `${L.answer}${L.colon}${letter ? `${letter}) ` : ''}${q.correctAnswer}`, { bold: true });
      if (q.explanation) {
        keep(2);
        labelled('', `${L.explanation}${L.colon}${q.explanation}`);
      }
      keep(2);
      const meta = `${L.source}${L.colon}${q.sourceLabel} · ${L.topic}${L.colon}${q.topic}`;
      write(meta, PAGE.margin + (rtlOf(meta) ? 0 : LABEL_WIDTH), doc.y, width - LABEL_WIDTH, { size: SIZE.small, gray: true });
      gap(0.9);
    });
  }

  // ---- footer on every page
  const pages = doc.bufferedPageRange();
  for (let p = 0; p < pages.count; p++) {
    doc.switchToPage(p);
    const y = doc.page.height - PAGE.margin + 18;
    doc.font('Sans').fontSize(SIZE.small).fillColor('#777777');
    // Footer text sits in the bottom margin: switch the margins off for this write so pdfkit does not add a page.
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const left = rtlUi ? fill(L.page, { x: p + 1, y: pages.count }) : fill(L.exported, { date: dateText });
    const right = rtlUi ? fill(L.exported, { date: dateText }) : fill(L.page, { x: p + 1, y: pages.count });
    doc.text(rtlUi ? prepareRtl(left) : left, PAGE.margin, y, { width: width / 2, align: 'left', lineBreak: false, ...(rtlUi ? { features: [] } : {}) });
    doc.text(rtlUi ? prepareRtl(right) : right, PAGE.margin + width / 2, y, { width: width / 2, align: 'right', lineBreak: false, ...(rtlUi ? { features: [] } : {}) });
    doc.page.margins.bottom = saved;
  }
  doc.end();
  return done;
}
