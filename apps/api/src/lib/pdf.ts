import { extractText, getDocumentProxy } from 'unpdf';

export type Chunk = { position: number; pageStart: number; pageEnd: number; content: string };

const TARGET_CHUNK_CHARS = 3000;

export async function extractPdfPages(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((t) => t.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
}

/** Groups consecutive pages into ~TARGET_CHUNK_CHARS chunks, keeping page ranges for citations later. */
export function chunkPages(pages: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let start = 1;
  const flush = (end: number) => {
    const content = buf.join('\n\n').trim();
    if (content) chunks.push({ position: chunks.length, pageStart: start, pageEnd: end, content });
    buf = [];
  };
  pages.forEach((page, i) => {
    const pageNo = i + 1;
    if (buf.length === 0) start = pageNo;
    buf.push(page);
    if (buf.join('\n\n').length >= TARGET_CHUNK_CHARS) flush(pageNo);
  });
  if (buf.length) flush(pages.length);
  return chunks;
}
