/**
 * Course documents: PDF or PowerPoint (.pptx). Format is detected from the bytes, never from the
 * file name or MIME type. Both produce "pages" (PDF pages / slides) for chunking and citations.
 */
import { PDF_MIME, PPTX_MIME } from '@study/shared';
import { HttpError } from './errors.js';
import { extractPdfPages } from './pdf.js';
import { bufferReader, extractPptxSlides, isPptx, looksLikeOle, looksLikeZip, PptxError } from './pptx.js';

export type DocumentFormat = 'pdf' | 'pptx';
export const MIME_BY_FORMAT: Record<DocumentFormat, string> = { pdf: PDF_MIME, pptx: PPTX_MIME };
export const formatForMime = (mime: string | null | undefined): DocumentFormat => (mime === PPTX_MIME ? 'pptx' : 'pdf');

/** PDF / PPTX, or a 415 with a clear code (legacy .ppt gets its own message). */
export async function detectDocumentFormat(bytes: Uint8Array): Promise<DocumentFormat> {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-') return 'pdf';
  if (looksLikeZip(bytes) && (await isPptx(bufferReader(bytes)))) return 'pptx';
  if (looksLikeOle(bytes)) {
    throw new HttpError(415, 'Old PowerPoint files (.ppt) are not supported. Save the presentation as .pptx or PDF and upload it again.', 'ppt_legacy');
  }
  throw new HttpError(415, 'Only PDF and PowerPoint (.pptx) files are supported', 'not_pdf');
}

/** Text per page/slide. Throws a 422 HttpError with a stable code the apps translate. */
export async function extractDocumentPages(bytes: Uint8Array, format: DocumentFormat): Promise<string[]> {
  if (format === 'pptx') {
    try {
      return await extractPptxSlides(bufferReader(bytes));
    } catch (err) {
      if (err instanceof PptxError && err.code === 'ppt_legacy') throw new HttpError(415, 'Old PowerPoint files (.ppt) are not supported.', 'ppt_legacy');
      console.error('[documents] PowerPoint extraction failed', err instanceof Error ? err.message : err);
      throw new HttpError(422, 'Could not read this PowerPoint file. It may be corrupted or password-protected.', 'pptx_unreadable');
    }
  }
  try {
    return await extractPdfPages(bytes);
  } catch (err) {
    console.error('[documents] PDF extraction failed', err instanceof Error ? err.message : err);
    throw new HttpError(422, 'Could not read this PDF. It may be corrupted or password-protected.', 'pdf_unreadable');
  }
}

/** 422 for a document without any text (scanned PDF, image-only slides). */
export function noTextError(format: DocumentFormat): HttpError {
  return format === 'pptx'
    ? new HttpError(422, 'No text found in this PowerPoint. Slides that are only images are not supported yet.', 'pptx_no_text')
    : new HttpError(422, 'No text found in this PDF. Scanned/image-only PDFs are not supported yet.', 'pdf_no_text');
}
