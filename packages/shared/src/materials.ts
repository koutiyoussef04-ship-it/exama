/**
 * Course materials: everything a course learns from — its original PDF plus extra PDFs, lecture
 * audio and lecture video. All of them feed the SAME course (topics, exams, practice, planner).
 *
 * Uploads: `POST /documents/:id/materials` with the raw file as the request body (streamed to disk;
 * large lectures never have to fit in memory) and these headers:
 *   Content-Type          the file's MIME type (informational — the server sniffs the real format)
 *   X-Exama-Title         URI-encoded display name (the original file name)
 *   X-Exama-Language      study/AI language for the notes (en | es | fr | ar | source)
 */
import { z } from 'zod';
import { aiLanguageSchema } from './languages';

/** `pdf` = a text document: a PDF or a PowerPoint (.pptx) — see `format`. */
export const MATERIAL_KINDS = ['pdf', 'audio', 'video'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** Formats the server accepts (detected from the file bytes, never from the name or MIME type). */
export const MATERIAL_FORMATS = ['pdf', 'pptx', 'mp3', 'm4a', 'wav', 'mp4', 'mov'] as const;
export type MaterialFormat = (typeof MATERIAL_FORMATS)[number];

/** MIME types the apps offer in the file picker (the server still verifies the content). */
export const MATERIAL_PICKER_TYPES: Record<MaterialKind, string[]> = {
  pdf: ['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  // Android file providers label .m4a files inconsistently (audio/mp4, audio/x-m4a, audio/mp4a-latm).
  audio: ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/m4a', 'audio/mp4a-latm', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave'],
  video: ['video/mp4', 'video/quicktime'],
};

/**
 * Processing status. "Uploading" is shown by the app while the bytes are being sent;
 * the server only knows a material once its upload has completed.
 *   processing   → queued / reading the file
 *   transcribing → audio/video is being transcribed
 *   analyzing    → Claude is extracting structured knowledge
 *   ready        → part of the course
 *   failed       → see errorCode; `canRetry` says whether a retry can work
 */
export const MATERIAL_STATUSES = ['processing', 'transcribing', 'analyzing', 'ready', 'failed'] as const;
export type MaterialStatus = (typeof MATERIAL_STATUSES)[number];

/** A course can hold at most this many added materials (plus its original PDF). */
export const MAX_MATERIALS_PER_COURSE = 30;

export const MATERIAL_HEADERS = { title: 'X-Exama-Title', language: 'X-Exama-Language' } as const;
export const materialLanguageSchema = aiLanguageSchema;

export type KnowledgeDefinition = { term: string; definition: string };

/** One topic a material teaches, as extracted by the AI and verified against the material. */
export type KnowledgeTopic = {
  /** Course topic name (existing names are reused exactly; new ones are added to the course). */
  name: string;
  /** True if this material introduced the topic to the course. */
  isNew: boolean;
  subtopics: string[];
  keyPoints: string[];
  definitions: KnowledgeDefinition[];
  examples: string[];
  /** Concepts likely to be examined. */
  examConcepts: string[];
  relatedTopics: string[];
  /** Verbatim excerpt (original language) that proves the material covers this topic. */
  sourceQuote: string;
  /** Where the quote is: seconds into the lecture (audio/video) or page (PDF). */
  startSeconds: number | null;
  page: number | null;
};

export type MaterialKnowledge = {
  /** 2-4 sentence overview of this material, in `language`. */
  summary: string;
  topics: KnowledgeTopic[];
  /**
   * What the extraction was based on. Audio/video are transcript-only: slides and diagrams shown
   * on screen but not spoken are NOT captured (the apps say so).
   */
  basis: 'text' | 'transcript';
};

export type CourseMaterial = {
  id: string;
  documentId: string;
  /** The course's original PDF (managed with the course itself: no retry/remove here). */
  primary: boolean;
  kind: MaterialKind;
  format: MaterialFormat;
  title: string;
  status: MaterialStatus;
  sizeBytes: number;
  durationSeconds: number | null;
  pageCount: number | null;
  /** Detected spoken/written language of the material (ISO 639-1). */
  sourceLanguage: string | null;
  /** Language of the AI notes (ISO 639-1), once processed. */
  language: string | null;
  errorCode: string | null;
  canRetry: boolean;
  /** Course topics this material covers / added. */
  topics: string[];
  newTopics: string[];
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};

export type CourseMaterialDetail = CourseMaterial & {
  summary: string | null;
  knowledge: MaterialKnowledge | null;
};

export const materialIdSchema = z.uuid();

/** Course documents: PDFs and PowerPoint presentations (.pptx). Legacy binary .ppt is not supported. */
export const PDF_MIME = 'application/pdf';
export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
/** Picker types for a course document (new course, or an extra document added to a course). */
export const DOCUMENT_PICKER_TYPES = [PDF_MIME, PPTX_MIME];
