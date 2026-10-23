/**
 * Exports of APPROVED bank items only, scoped to one organization. Drafts, rejected and retired questions are
 * never exported. Formats:
 *  - CSV (RFC 4180: every field quoted, quotes doubled, CRLF line ends, UTF-8 BOM so Excel reads accents;
 *    fields that would be read as formulas are prefixed with an apostrophe)
 *  - GIFT (Moodle's text format: `~`, `=`, `#`, `{`, `}`, `:` and `\` escaped; one question per block)
 *  - XLSX (one sheet, the same columns as the CSV, as inline strings — lib/xlsx.ts)
 *  - PDF (a question paper: student version without answers, or teacher version with a separate answer key —
 *    export-pdf.ts)
 * The route sends the question count in X-Exama-Export-Count and the file name in Content-Disposition; both are
 * CORS-exposed (app.ts) so the web app can read them.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { ExportFormat, Language, PdfMode } from '@study/shared';
import { db } from '../../db/client.js';
import { bankItems, documents, questionSources } from '../../db/schema.js';
import { xlsx } from '../../lib/xlsx.js';
import { renderPdf, type PdfQuestion } from './export-pdf.js';

type Row = typeof bankItems.$inferSelect & { documentTitle: string; sourceLabel: string; quote: string | null };

export type ExportFile = { filename: string; contentType: string; body: string | Buffer; count: number };

async function approvedItems(orgId: string, filter: { documentId?: string; topic?: string }): Promise<Row[]> {
  const rows = await db
    .select({ item: bankItems, documentTitle: documents.title })
    .from(bankItems)
    .innerJoin(documents, eq(documents.id, bankItems.documentId))
    .where(
      and(
        eq(bankItems.organizationId, orgId),
        eq(bankItems.status, 'approved'),
        filter.documentId ? eq(bankItems.documentId, filter.documentId) : undefined,
        filter.topic ? eq(bankItems.topic, filter.topic) : undefined,
      ),
    )
    .orderBy(asc(bankItems.section), asc(bankItems.topic), asc(bankItems.createdAt));
  if (rows.length === 0) return [];
  const sources = await db
    .select()
    .from(questionSources)
    .where(eq(questionSources.organizationId, orgId));
  const byItem = new Map<string, (typeof sources)[number]>();
  for (const s of sources) if (!byItem.has(s.bankItemId)) byItem.set(s.bankItemId, s);
  return rows.map(({ item, documentTitle }) => {
    const src = byItem.get(item.id);
    return { ...item, documentTitle, sourceLabel: sourceLabel(documentTitle, src), quote: src?.quote ?? null };
  });
}

/** "Course title, p. 12-13" / "Course title, 03:20" / "Course title (location not confirmed)". Never a made-up page. */
export function sourceLabel(documentTitle: string, s?: { located: boolean; pageStart: number | null; pageEnd: number | null; startSeconds: number | null } | null): string {
  if (!s) return documentTitle;
  if (!s.located) return `${documentTitle} (location not confirmed)`;
  if (s.pageStart) return `${documentTitle}, p. ${s.pageStart}${s.pageEnd && s.pageEnd !== s.pageStart ? `-${s.pageEnd}` : ''}`;
  if (s.startSeconds !== null) {
    const m = Math.floor(s.startSeconds / 60);
    const sec = s.startSeconds % 60;
    return `${documentTitle}, ${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return documentTitle;
}

/**
 * One CSV field: quoted, quotes doubled (RFC 4180), and defused against formula injection. Spreadsheet apps
 * evaluate a cell that starts with `=`, `+`, `-` or `@` (and some trim a leading tab or CR first) even when it is
 * quoted, so a question written as `=HYPERLINK(...)` by an editor or by the model would run when a colleague
 * opens the export. Such a value is prefixed with an apostrophe, which spreadsheets show as text.
 */
const csvField = (v: string | number | null | undefined) => {
  const text = String(v ?? '');
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** The table both the CSV and the workbook contain: one row per approved question, one column per field. */
export const TABLE_HEADER = ['id', 'version', 'course', 'section', 'topic', 'type', 'difficulty', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'option_f', 'correct_answer', 'explanation', 'source', 'source_quote', 'law', 'publication', 'article', 'effective_date'] as const;
export function tableRow(r: Row): string[] {
  const opts = r.type === 'mcq' ? (r.options ?? []) : [];
  const legal = r.legalRef ?? { law: '', publication: '', article: '', effectiveDate: '' };
  return [
    r.id,
    String(r.version),
    r.documentTitle,
    r.section ?? '',
    r.topic,
    r.type,
    r.difficulty ?? '',
    r.stem,
    ...Array.from({ length: 6 }, (_, i) => opts[i] ?? ''),
    r.correctAnswer,
    r.explanation,
    r.sourceLabel,
    r.quote ?? '',
    legal.law,
    legal.publication,
    legal.article,
    legal.effectiveDate,
  ];
}

export function toCsv(rows: Row[]): string {
  const lines = [TABLE_HEADER.map(csvField).join(',')];
  for (const r of rows) lines.push(tableRow(r).map(csvField).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Column widths (Excel character units) for the workbook: ids and short codes narrow, texts wide. */
const XLSX_WIDTHS: Record<(typeof TABLE_HEADER)[number], number> = { id: 38, version: 8, course: 28, section: 16, topic: 24, type: 12, difficulty: 10, question: 60, option_a: 32, option_b: 32, option_c: 32, option_d: 32, option_e: 24, option_f: 24, correct_answer: 32, explanation: 60, source: 30, source_quote: 50, law: 20, publication: 20, article: 12, effective_date: 14 };

export function toXlsx(rows: Row[], now = new Date()): Buffer {
  return xlsx({ sheetName: 'Questions', title: 'Exama — approved questions', columns: TABLE_HEADER.map((h) => ({ header: h, width: XLSX_WIDTHS[h] })), rows: rows.map(tableRow), now });
}

const toPdfQuestion = (r: Row): PdfQuestion => ({
  type: r.type,
  stem: r.stem,
  options: r.type === 'mcq' ? (r.options ?? []) : [],
  correctAnswer: r.correctAnswer,
  explanation: r.explanation,
  topic: r.topic,
  section: r.section ?? null,
  documentTitle: r.documentTitle,
  sourceLabel: r.sourceLabel,
});

/** GIFT escaping: the characters Moodle's parser treats as syntax. */
export const giftEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/([~=#{}:])/g, '\\$1').replace(/\r?\n/g, '<br>');

export function toGift(rows: Row[]): string {
  const blocks: string[] = [];
  let lastGroup: string | null = null;
  for (const r of rows) {
    const group = [r.documentTitle, r.section].filter(Boolean).join(' / ');
    if (group !== lastGroup) {
      blocks.push(`$CATEGORY: $course$/top/${giftEscape(group)}\n`);
      lastGroup = group;
    }
    const comment = `// ${r.topic} · source: ${r.sourceLabel} · id ${r.id} v${r.version}`;
    const title = `::${giftEscape(r.stem.slice(0, 60))}::`;
    const feedback = r.explanation ? `#${giftEscape(r.explanation)}` : '';
    if (r.type === 'mcq') {
      const answers = (r.options ?? []).map((o) => `${o === r.correctAnswer ? '=' : '~'}${giftEscape(o)}`).join('\n');
      blocks.push(`${comment}\n${title}${giftEscape(r.stem)} {\n${answers}\n${feedback}\n}\n`);
    } else {
      blocks.push(`${comment}\n${title}${giftEscape(r.stem)} {=${giftEscape(r.correctAnswer)}${feedback}}\n`);
    }
  }
  return blocks.join('\n');
}

export type ExportOptions = {
  format: ExportFormat;
  documentId?: string;
  topic?: string;
  /** PDF: student (default) or teacher. */
  mode?: PdfMode;
  /** PDF: language of the fixed labels. */
  language?: Language;
};

export async function exportApproved(org: { id: string; name: string }, opts: ExportOptions, now = new Date()): Promise<ExportFile> {
  const filter = { documentId: opts.documentId, topic: opts.topic };
  const rows = await approvedItems(org.id, filter);
  const stamp = now.toISOString().slice(0, 10);
  switch (opts.format) {
    case 'csv':
      return { filename: `exama-questions-${stamp}.csv`, contentType: 'text/csv; charset=utf-8', body: toCsv(rows), count: rows.length };
    case 'gift':
      return { filename: `exama-questions-${stamp}.gift.txt`, contentType: 'text/plain; charset=utf-8', body: toGift(rows), count: rows.length };
    case 'xlsx':
      return { filename: `exama-questions-${stamp}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', body: toXlsx(rows, now), count: rows.length };
    case 'pdf': {
      const mode: PdfMode = opts.mode ?? 'student';
      // The course title for the paper's header: from the rows, or looked up when the filtered course has no approved question yet.
      const course = opts.documentId ? (rows[0]?.documentTitle ?? (await courseTitle(org.id, opts.documentId))) : null;
      const body = await renderPdf(rows.map(toPdfQuestion), { organization: org.name, course, topic: opts.topic ?? null, mode, language: opts.language ?? 'en', now });
      return { filename: `exama-questions-${stamp}-${mode}.pdf`, contentType: 'application/pdf', body, count: rows.length };
    }
  }
}

async function courseTitle(orgId: string, documentId: string): Promise<string | null> {
  const [doc] = await db.select({ title: documents.title }).from(documents).where(and(eq(documents.id, documentId), eq(documents.organizationId, orgId)));
  return doc?.title ?? null;
}
