/**
 * Exports of APPROVED bank items only, scoped to one organization. Drafts, rejected and retired questions are
 * never exported. Formats:
 *  - CSV (RFC 4180: every field quoted, quotes doubled, CRLF line ends, UTF-8 BOM so Excel reads accents)
 *  - GIFT (Moodle's text format: `~`, `=`, `#`, `{`, `}`, `:` and `\` escaped; one question per block)
 */
import { and, asc, eq } from 'drizzle-orm';
import type { ExportFormat } from '@study/shared';
import { db } from '../../db/client.js';
import { bankItems, documents, questionSources } from '../../db/schema.js';

type Row = typeof bankItems.$inferSelect & { documentTitle: string; sourceLabel: string; quote: string | null };

export type ExportFile = { filename: string; contentType: string; body: string; count: number };

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

const csvField = (v: string | number | null | undefined) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function toCsv(rows: Row[]): string {
  const header = ['id', 'version', 'course', 'section', 'topic', 'type', 'difficulty', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'option_e', 'option_f', 'correct_answer', 'explanation', 'source', 'source_quote', 'law', 'publication', 'article', 'effective_date'];
  const lines = [header.map(csvField).join(',')];
  for (const r of rows) {
    const opts = r.type === 'mcq' ? (r.options ?? []) : [];
    const legal = r.legalRef ?? { law: '', publication: '', article: '', effectiveDate: '' };
    lines.push(
      [
        r.id,
        r.version,
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
      ]
        .map(csvField)
        .join(','),
    );
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

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

export async function exportApproved(orgId: string, format: ExportFormat, filter: { documentId?: string; topic?: string }): Promise<ExportFile> {
  const rows = await approvedItems(orgId, filter);
  const stamp = new Date().toISOString().slice(0, 10);
  return format === 'csv'
    ? { filename: `exama-questions-${stamp}.csv`, contentType: 'text/csv; charset=utf-8', body: toCsv(rows), count: rows.length }
    : { filename: `exama-questions-${stamp}.gift.txt`, contentType: 'text/plain; charset=utf-8', body: toGift(rows), count: rows.length };
}
