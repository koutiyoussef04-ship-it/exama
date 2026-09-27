/**
 * PowerPoint (.pptx) text extraction — no dependency: a .pptx is a ZIP of XML files.
 *
 * Output: one text block per slide, in presentation order (ppt/presentation.xml), with the slide's
 * speaker notes appended — the same "pages" shape as a PDF, so chunking, AI analysis, grounding
 * and citations work unchanged (a "page" is a slide).
 *
 * Safety: only the XML parts we need are inflated, each capped in size (zip-bomb protection);
 * ZIP64 and encrypted archives are refused. Legacy binary .ppt files are detected and refused with
 * a clear message (save as .pptx or PDF).
 */
import { inflateRawSync } from 'node:zlib';

export class PptxError extends Error {
  constructor(readonly code: 'pptx_unreadable' | 'ppt_legacy') {
    super(code);
  }
}

/** Random-access reader (a Buffer in memory, or a stored file). */
export type ByteReader = { size: number; read(offset: number, length: number): Promise<Uint8Array> };
export const bufferReader = (bytes: Uint8Array): ByteReader => ({
  size: bytes.byteLength,
  read: async (offset, length) => bytes.subarray(offset, Math.min(bytes.byteLength, offset + length)),
});

const MAX_ENTRIES = 20_000;
const MAX_PART_BYTES = 8 * 1024 * 1024; // one slide/notes/presentation XML part, uncompressed
const MAX_TOTAL_BYTES = 80 * 1024 * 1024; // all parts we inflate together
const MAX_SLIDES = 1_000;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

/** First bytes of a ZIP local file header ("PK\x03\x04"). */
export const looksLikeZip = (head: Uint8Array) => head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
/** First bytes of an OLE2 compound file — legacy .ppt / .doc / .xls. */
export const looksLikeOle = (head: Uint8Array) => head.length >= 8 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0 && head[4] === 0xa1 && head[5] === 0xb1;

type Entry = { name: string; method: number; compressedSize: number; size: number; localOffset: number; flags: number };

async function readCentralDirectory(r: ByteReader): Promise<Map<string, Entry>> {
  const tailLen = Math.min(r.size, 22 + 0xffff);
  const tail = await r.read(r.size - tailLen, tailLen);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new PptxError('pptx_unreadable');
  const count = u16(tail, eocd + 10);
  const cdSize = u32(tail, eocd + 12);
  const cdOffset = u32(tail, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || count > MAX_ENTRIES || cdOffset + cdSize > r.size) throw new PptxError('pptx_unreadable');
  const cd = await r.read(cdOffset, cdSize);
  const entries = new Map<string, Entry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || u32(cd, p) !== 0x02014b50) throw new PptxError('pptx_unreadable');
    const nameLen = u16(cd, p + 28);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, {
      name,
      flags: u16(cd, p + 8),
      method: u16(cd, p + 10),
      compressedSize: u32(cd, p + 20),
      size: u32(cd, p + 24),
      localOffset: u32(cd, p + 42),
    });
    p += 46 + nameLen + u16(cd, p + 30) + u16(cd, p + 32);
  }
  return entries;
}

/** Is this ZIP a PowerPoint presentation (not a Word/Excel file or any other ZIP)? */
export async function isPptx(r: ByteReader): Promise<boolean> {
  try {
    const entries = await readCentralDirectory(r);
    return entries.has('ppt/presentation.xml') && entries.has('[Content_Types].xml');
  } catch {
    return false;
  }
}

function createInflater(r: ByteReader, entries: Map<string, Entry>) {
  let total = 0;
  return async function text(name: string): Promise<string | null> {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 0x1) throw new PptxError('pptx_unreadable'); // encrypted (password-protected)
    if (e.size > MAX_PART_BYTES || e.compressedSize > MAX_PART_BYTES) throw new PptxError('pptx_unreadable');
    const header = await r.read(e.localOffset, 30);
    if (header.length < 30 || u32(header, 0) !== 0x04034b50) throw new PptxError('pptx_unreadable');
    const dataStart = e.localOffset + 30 + u16(header, 26) + u16(header, 28);
    const raw = await r.read(dataStart, e.compressedSize);
    let out: Uint8Array;
    if (e.method === 0) out = raw;
    else if (e.method === 8) {
      try {
        out = inflateRawSync(raw, { maxOutputLength: MAX_PART_BYTES });
      } catch {
        throw new PptxError('pptx_unreadable');
      }
    } else throw new PptxError('pptx_unreadable');
    total += out.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new PptxError('pptx_unreadable');
    return new TextDecoder().decode(out);
  };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? '';
    const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  });

/** DrawingML text: one line per paragraph (<a:p>), runs (<a:t>) joined, <a:br/> = line break. */
export function drawingText(xml: string): string[] {
  const lines: string[] = [];
  for (const para of xml.split(/<\/a:p>/)) {
    const parts: string[] = [];
    for (const m of para.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>|<a:br\b[^>]*\/>/g)) parts.push(m[1] !== undefined ? decode(m[1]) : '\n');
    const line = parts.join('').replace(/[ \t ]+/g, ' ').trim();
    if (line) lines.push(line);
  }
  return lines;
}

/** Relationship id → target path, resolved against the part's folder. */
function relationships(xml: string | null, baseDir: string): { id: string; type: string; target: string }[] {
  if (!xml) return [];
  const out: { id: string; type: string; target: string }[] = [];
  for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attr = (n: string) => m[1].match(new RegExp(`\\b${n}="([^"]*)"`))?.[1];
    const id = attr('Id');
    const target = attr('Target');
    if (!id || !target || attr('TargetMode') === 'External') continue;
    out.push({ id, type: attr('Type') ?? '', target: resolvePath(baseDir, decode(target)) });
  }
  return out;
}

function resolvePath(baseDir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${baseDir}/${target}`).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p && p !== '.') out.push(p);
  }
  return out.join('/');
}

/** Text of each slide, in presentation order, with its speaker notes. */
export async function extractPptxSlides(r: ByteReader): Promise<string[]> {
  const entries = await readCentralDirectory(r);
  const text = createInflater(r, entries);
  const presentation = await text('ppt/presentation.xml');
  if (!presentation) throw new PptxError('pptx_unreadable');

  // Presentation order: <p:sldIdLst><p:sldId r:id="rId2"/>… → ppt/_rels/presentation.xml.rels.
  const rels = new Map(relationships(await text('ppt/_rels/presentation.xml.rels'), 'ppt').map((x) => [x.id, x.target]));
  let slidePaths = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => rels.get(m[1])).filter((p): p is string => !!p && entries.has(p));
  if (!slidePaths.length) {
    // Fallback: file-name order (slide1.xml, slide2.xml, …).
    slidePaths = [...entries.keys()]
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  }
  if (slidePaths.length > MAX_SLIDES) slidePaths = slidePaths.slice(0, MAX_SLIDES);

  const slides: string[] = [];
  for (const path of slidePaths) {
    const xml = (await text(path)) ?? '';
    const lines = drawingText(xml);
    const dir = path.slice(0, path.lastIndexOf('/'));
    const file = path.slice(path.lastIndexOf('/') + 1);
    const notesPath = relationships(await text(`${dir}/_rels/${file}.rels`), dir).find((x) => x.type.endsWith('/notesSlide'))?.target;
    // Notes pages also hold the slide-number placeholder: drop lines that are only a number.
    const notes = notesPath ? drawingText((await text(notesPath)) ?? '').filter((l) => !/^\d+$/.test(l)) : [];
    slides.push([lines.join('\n'), notes.length ? `Notes: ${notes.join('\n')}` : ''].filter(Boolean).join('\n\n'));
  }
  return slides;
}
