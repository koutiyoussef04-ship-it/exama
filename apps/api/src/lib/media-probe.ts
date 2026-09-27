/**
 * Identifies an uploaded course material from its BYTES (never its name or declared MIME type)
 * and reads a lecture's duration, without loading the file into memory and without ffmpeg.
 *
 * Supported: PDF · PowerPoint (.pptx) · MP3 (MPEG-1/2/2.5 Layer III) · WAV (RIFF/WAVE) · MP4/M4A/MOV (ISO-BMFF / QuickTime).
 * Anything else is rejected. The duration drives plan limits BEFORE any paid transcription; the
 * transcription provider is additionally told to stop at the reserved length, so a file whose
 * headers lie about its length still can't cost more than was reserved.
 */
import type { MaterialFormat, MaterialKind } from '@study/shared';
import { isPptx, looksLikeOle, looksLikeZip } from './pptx.js';

export type ProbeErrorCode = 'unsupported_format' | 'media_unreadable' | 'media_no_audio' | 'ppt_legacy';

export class ProbeError extends Error {
  constructor(
    public code: ProbeErrorCode,
    detail: string,
  ) {
    super(detail);
  }
}

export type ProbeResult = {
  format: MaterialFormat;
  kind: MaterialKind;
  /** Seconds (rounded up). null for PDFs and PowerPoints. */
  durationSeconds: number | null;
  hasVideo: boolean;
};

/** Random-access reader over a stored file. */
export type ByteReader = { size: number; read(start: number, length: number): Promise<Uint8Array> };

/** In-memory reader (tests, small buffers). */
export const bufferReader = (buf: Uint8Array): ByteReader => ({
  size: buf.byteLength,
  read: async (start, length) => buf.subarray(start, Math.min(buf.byteLength, start + length)),
});

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));
const u16le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u64be = (b: Uint8Array, o: number) => u32be(b, o) * 2 ** 32 + u32be(b, o + 4);

/** Sanity bound: nothing we accept is longer than a day. */
const MAX_PLAUSIBLE_SECONDS = 24 * 3600;

function finish(format: MaterialFormat, kind: MaterialKind, seconds: number, hasVideo = false): ProbeResult {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_PLAUSIBLE_SECONDS) {
    throw new ProbeError('media_unreadable', `implausible duration ${seconds}s`);
  }
  return { format, kind, durationSeconds: Math.max(1, Math.ceil(seconds)), hasVideo };
}

export async function probeMedia(r: ByteReader): Promise<ProbeResult> {
  if (r.size < 16) throw new ProbeError('unsupported_format', 'file too small');
  const head = await r.read(0, 64);

  if (ascii(head, 0, 5) === '%PDF-') return { format: 'pdf', kind: 'pdf', durationSeconds: null, hasVideo: false };
  // PowerPoint is a ZIP: check its directory really is a presentation (not a .docx/.xlsx/other ZIP).
  if (looksLikeZip(head)) {
    if (await isPptx(r)) return { format: 'pptx', kind: 'pdf', durationSeconds: null, hasVideo: false };
    throw new ProbeError('unsupported_format', 'zip that is not a presentation');
  }
  if (looksLikeOle(head)) throw new ProbeError('ppt_legacy', 'legacy Office file');
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return probeWav(r);
  const box = ascii(head, 4, 4);
  if (box === 'ftyp' || ['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(box)) return probeIsoBmff(r, head);
  if (ascii(head, 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return probeMp3(r, head);
  throw new ProbeError('unsupported_format', 'unknown signature');
}

// ---------------------------------------------------------------- WAV

async function probeWav(r: ByteReader): Promise<ProbeResult> {
  let offset = 12;
  let byteRate = 0;
  for (let i = 0; i < 64 && offset + 8 <= r.size; i++) {
    const h = await r.read(offset, 24);
    if (h.length < 8) break;
    const id = ascii(h, 0, 4);
    const size = u32le(h, 4);
    if (id === 'fmt ') {
      if (h.length < 20) break;
      byteRate = u32le(h, 16);
      const channels = u16le(h, 10);
      if (!channels) throw new ProbeError('media_no_audio', 'wav without channels');
    } else if (id === 'data') {
      if (!byteRate) throw new ProbeError('media_unreadable', 'wav data before fmt');
      const available = r.size - (offset + 8);
      const dataSize = size === 0 || size === 0xffffffff ? available : Math.min(size, available);
      if (dataSize <= 0) throw new ProbeError('media_no_audio', 'empty wav data');
      return finish('wav', 'audio', dataSize / byteRate);
    }
    offset += 8 + size + (size % 2); // chunks are word-aligned
  }
  throw new ProbeError('media_unreadable', 'wav without data chunk');
}

// ---------------------------------------------------------------- MP3

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

type Mp3Frame = { length: number; samples: number; sampleRate: number; bitrate: number; version: number; mono: boolean };

function parseMp3Header(b: Uint8Array, o: number): Mp3Frame | null {
  if (o + 4 > b.length || b[o] !== 0xff || (b[o + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[o + 1] >> 3) & 3; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
  const layer = (b[o + 1] >> 1) & 3; // 1 = Layer III
  if (version === 1 || layer !== 1) return null;
  const bitrateIndex = b[o + 2] >> 4;
  const srIndex = (b[o + 2] >> 2) & 3;
  if (bitrateIndex === 0 || bitrateIndex === 15 || srIndex === 3) return null;
  const bitrate = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][srIndex];
  const padding = (b[o + 2] >> 1) & 1;
  const samples = version === 3 ? 1152 : 576;
  const length = Math.floor(((samples / 8) * bitrate) / sampleRate) + padding;
  return { length, samples, sampleRate, bitrate, version, mono: b[o + 3] >> 6 === 3 };
}

async function probeMp3(r: ByteReader, head: Uint8Array): Promise<ProbeResult> {
  let start = 0;
  if (ascii(head, 0, 3) === 'ID3') {
    const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    start = 10 + size + (head[5] & 0x10 ? 10 : 0);
  }
  // Find the first frame that is followed by two more consistent frames (avoids false syncs).
  const window = await r.read(start, 256 * 1024);
  let first = -1;
  let frame: Mp3Frame | null = null;
  for (let i = 0; i + 4 < window.length && first < 0; i++) {
    const f = parseMp3Header(window, i);
    if (!f) continue;
    const n1 = parseMp3Header(window, i + f.length);
    const n2 = n1 ? parseMp3Header(window, i + f.length + n1.length) : null;
    if (n1 && n2 && n1.sampleRate === f.sampleRate && n2.sampleRate === f.sampleRate) {
      first = i;
      frame = f;
    }
  }
  if (!frame || first < 0) throw new ProbeError('unsupported_format', 'no mp3 frames');

  // Xing/Info (VBR/CBR) or VBRI header with the exact frame count.
  const sideInfo = frame.version === 3 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
  const x = first + 4 + sideInfo;
  const tag = ascii(window, x, 4);
  if ((tag === 'Xing' || tag === 'Info') && u32be(window, x + 4) & 1) {
    const frames = u32be(window, x + 8);
    if (frames > 0) return finish('mp3', 'audio', (frames * frame.samples) / frame.sampleRate);
  }
  if (ascii(window, first + 36, 4) === 'VBRI') {
    const frames = u32be(window, first + 36 + 14);
    if (frames > 0) return finish('mp3', 'audio', (frames * frame.samples) / frame.sampleRate);
  }

  // No header: count frames (reads the file sequentially in 1 MB blocks, headers only).
  let pos = start + first;
  let seconds = 0;
  let frames = 0;
  const BLOCK = 1024 * 1024;
  let block: Uint8Array = new Uint8Array(0);
  let blockStart = 0;
  while (pos + 4 <= r.size) {
    if (pos + 4 > blockStart + block.length) {
      blockStart = pos;
      block = await r.read(pos, BLOCK);
      if (block.length < 4) break;
    }
    const f = parseMp3Header(block, pos - blockStart);
    if (!f) break; // trailing tags (ID3v1/APE) or garbage: stop counting
    seconds += f.samples / f.sampleRate;
    frames++;
    pos += f.length;
  }
  if (frames < 3) throw new ProbeError('media_unreadable', 'too few mp3 frames');
  return finish('mp3', 'audio', seconds);
}

// ---------------------------------------------------------------- MP4 / M4A / MOV

type Box = { type: string; start: number; size: number; header: number };

/** Lists child boxes in [from, to) by reading box headers only. */
async function listBoxes(r: ByteReader, from: number, to: number, budget: { n: number }): Promise<Box[]> {
  const out: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    if (--budget.n < 0) throw new ProbeError('media_unreadable', 'too many boxes');
    const h = await r.read(o, 16);
    if (h.length < 8) break;
    let size = u32be(h, 0);
    const type = ascii(h, 4, 4);
    let header = 8;
    if (size === 1) {
      if (h.length < 16) break;
      size = u64be(h, 8);
      header = 16;
    } else if (size === 0) {
      size = to - o;
    }
    if (size < header || o + size > to + 8) throw new ProbeError('media_unreadable', `bad box ${type}`);
    out.push({ type, start: o, size: Math.min(size, to - o), header });
    o += size;
  }
  return out;
}

/** mvhd/mdhd: [timescale, duration]. */
async function readTimeHeader(r: ByteReader, box: Box): Promise<[number, number]> {
  const b = await r.read(box.start + box.header, 32);
  const version = b[0];
  if (version === 1) return [u32be(b, 20), u64be(b, 24)];
  return [u32be(b, 12), u32be(b, 16)];
}

async function probeIsoBmff(r: ByteReader, head: Uint8Array): Promise<ProbeResult> {
  const brand = ascii(head, 4, 4) === 'ftyp' ? ascii(head, 8, 4) : 'qt  ';
  const budget = { n: 5000 };
  const top = await listBoxes(r, 0, r.size, budget);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new ProbeError('media_unreadable', 'no moov box (incomplete recording?)');

  const children = await listBoxes(r, moov.start + moov.header, moov.start + moov.size, budget);
  let movieSeconds = 0;
  const mvhd = children.find((b) => b.type === 'mvhd');
  if (mvhd) {
    const [scale, duration] = await readTimeHeader(r, mvhd);
    if (scale) movieSeconds = duration / scale;
  }
  let audioSeconds = 0;
  let hasAudio = false;
  let hasVideo = false;
  for (const trak of children.filter((b) => b.type === 'trak')) {
    const mdia = (await listBoxes(r, trak.start + trak.header, trak.start + trak.size, budget)).find((b) => b.type === 'mdia');
    if (!mdia) continue;
    const parts = await listBoxes(r, mdia.start + mdia.header, mdia.start + mdia.size, budget);
    const hdlr = parts.find((b) => b.type === 'hdlr');
    if (!hdlr) continue;
    const handler = ascii(await r.read(hdlr.start + hdlr.header + 8, 4), 0, 4);
    if (handler === 'vide') hasVideo = true;
    if (handler === 'soun') {
      hasAudio = true;
      const mdhd = parts.find((b) => b.type === 'mdhd');
      if (mdhd) {
        const [scale, duration] = await readTimeHeader(r, mdhd);
        if (scale) audioSeconds = Math.max(audioSeconds, duration / scale);
      }
    }
  }
  if (!hasAudio) throw new ProbeError('media_no_audio', 'no sound track');
  const seconds = audioSeconds || movieSeconds;
  if (hasVideo) return finish(brand === 'qt  ' ? 'mov' : 'mp4', 'video', seconds, true);
  return finish('m4a', 'audio', seconds);
}
