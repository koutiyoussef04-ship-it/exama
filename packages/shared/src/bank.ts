/**
 * Question bank (organizations): reviewable, versioned questions with their source references.
 *
 * Lifecycle: AI writes `draft` items (never approved automatically) → a person edits, approves or rejects
 * them → approved items are exported or reused → an approved item can be retired. Every edit creates a new
 * version and sends the item back to `draft`; every action is recorded as an event.
 */
import { z } from 'zod';
import { aiLanguageSchema } from './languages';

export const BANK_ITEM_STATUSES = ['draft', 'approved', 'rejected', 'retired'] as const;
export type BankItemStatus = (typeof BANK_ITEM_STATUSES)[number];

export const BANK_ITEM_TYPES = ['mcq', 'short_answer'] as const;
export type BankItemType = (typeof BANK_ITEM_TYPES)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const MAX_ITEMS_PER_GENERATION = 20;

/** Legal source metadata (oposiciones): entered by staff, never invented by the AI. */
export const legalRefSchema = z.object({
  /** Law or regulation, e.g. "Ley 39/2015". */
  law: z.string().trim().max(200),
  /** Official publication reference, e.g. "BOE-A-2015-10565". */
  publication: z.string().trim().max(200).optional().default(''),
  /** Article or section, e.g. "art. 21.2". */
  article: z.string().trim().max(100).optional().default(''),
  /** Effective or consolidated-version date (YYYY-MM-DD). */
  effectiveDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(''))
    .default(''),
});
export type LegalRef = z.output<typeof legalRefSchema>;

export const generateBankItemsSchema = z.object({
  count: z.number().int().min(1).max(MAX_ITEMS_PER_GENERATION).default(10),
  /** Limit generation to one course topic (must be one of the course's topics). */
  topic: z.string().trim().min(1).max(200).optional(),
  /** Limit the source material to a page range (PDF pages / slides, 1-based, inclusive). */
  pageStart: z.number().int().min(1).optional(),
  pageEnd: z.number().int().min(1).optional(),
  /** Question types: mcq only, or the generator's usual mix. Defaults to the market profile. */
  questionTypes: z.enum(['mcq', 'mixed']).optional(),
  language: aiLanguageSchema.optional(),
});
export type GenerateBankItemsInput = z.input<typeof generateBankItemsSchema>;

export const createBankItemSchema = z.object({
  documentId: z.uuid(),
  type: z.enum(BANK_ITEM_TYPES),
  topic: z.string().trim().min(1).max(200),
  section: z.string().trim().max(120).optional().nullable(),
  stem: z.string().trim().min(1).max(2000),
  options: z.array(z.string().trim().min(1).max(500)).min(2).max(8).nullable(),
  correctAnswer: z.string().trim().min(1).max(2000),
  explanation: z.string().trim().max(2000).default(''),
  difficulty: z.enum(DIFFICULTIES).nullable().optional(),
  legalRef: legalRefSchema.nullable().optional(),
});
export type CreateBankItemInput = z.input<typeof createBankItemSchema>;

export const updateBankItemSchema = createBankItemSchema.omit({ documentId: true, type: true }).partial();
export type UpdateBankItemInput = z.input<typeof updateBankItemSchema>;

export const reviewNoteSchema = z.object({ note: z.string().trim().max(1000).optional() });

export const ATTENTION_FILTERS = ['flagged', 'clean'] as const;
export type AttentionFilter = (typeof ATTENTION_FILTERS)[number];

export const listBankItemsSchema = z.object({
  documentId: z.uuid().optional(),
  status: z.enum(BANK_ITEM_STATUSES).optional(),
  topic: z.string().trim().min(1).max(200).optional(),
  section: z.string().trim().min(1).max(120).optional(),
  /** Free-text search in the question text, options, explanation and topic (case-insensitive substring). */
  q: z.string().trim().min(1).max(200).optional(),
  /** `flagged`: items with review flags or a non-supported verdict; `clean`: none of those. */
  attention: z.enum(ATTENTION_FILTERS).optional(),
  /** Newest first by default; `oldest` for a review queue that works through drafts in arrival order. */
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const EXPORT_FORMATS = ['csv', 'gift'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const exportQuerySchema = z.object({
  format: z.enum(EXPORT_FORMATS),
  documentId: z.uuid().optional(),
  topic: z.string().trim().min(1).max(200).optional(),
});

/**
 * Review flags set by the server after generation (never by the model's own confidence):
 * - fuzzy_quote: the quote matched the material approximately, not exactly
 * - unlocated: the quote could not be placed in a single passage (no page/offsets; location uncertain)
 * - unsupported / partial: the verifier found the passage does not (fully) support the keyed answer
 * - verifier_unavailable: the verification call failed; the item was not checked
 * - number_not_in_source: a number or year in the answer does not appear in the passage
 * - weak_distractors: MCQ options overlap or include "all/none of the above"
 */
export const REVIEW_FLAGS = ['fuzzy_quote', 'unlocated', 'unsupported', 'partial', 'verifier_unavailable', 'number_not_in_source', 'weak_distractors'] as const;
export type ReviewFlag = (typeof REVIEW_FLAGS)[number];

export type Verification = { verdict: 'supported' | 'partial' | 'unsupported' | 'unavailable'; note: string };

export type QuestionSource = {
  id: string;
  documentId: string;
  materialId: string | null;
  /** The text chunk the quote was found in (null when the chunk no longer exists). */
  chunkId: string | null;
  /** SHA-256 of the chunk text at the time, so a changed source can be detected. */
  chunkHash: string;
  /** PDF pages / slides (1-based) when the source is a document. */
  pageStart: number | null;
  pageEnd: number | null;
  /** Seconds into the recording when the source is a lecture. */
  startSeconds: number | null;
  endSeconds: number | null;
  quote: string;
  /** Character offsets of the quote inside the chunk (null when only an approximate match was found). */
  quoteStart: number | null;
  quoteEnd: number | null;
  /** 1 = verbatim; lower = approximate (trigram overlap). */
  matchScore: number;
  /** False when the quote could not be placed in one passage: the location above is unknown, not guessed. */
  located: boolean;
};

export type BankItemEvent = {
  id: string;
  action: 'generated' | 'created' | 'edited' | 'approved' | 'rejected' | 'retired' | 'reopened';
  actorUserId: string | null;
  actorName: string | null;
  version: number;
  note: string | null;
  createdAt: string;
};

export type BankItem = {
  id: string;
  organizationId: string;
  documentId: string;
  documentTitle: string;
  type: BankItemType;
  topic: string;
  section: string | null;
  stem: string;
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  difficulty: Difficulty | null;
  status: BankItemStatus;
  version: number;
  origin: 'ai' | 'manual';
  reviewFlags: ReviewFlag[];
  verification: Verification | null;
  legalRef: LegalRef | null;
  createdBy: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
  updatedAt: string;
  sources: QuestionSource[];
};

/** The passage a source quote was located in, for the review screen. Null when the chunk is gone or its text changed. */
export type SourcePassage = {
  sourceId: string;
  text: string;
  /** Offsets of the quote inside `text` (null when only an approximate match is known). */
  quoteStart: number | null;
  quoteEnd: number | null;
  pageStart: number | null;
  pageEnd: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
};

export type BankItemDetail = BankItem & { events: BankItemEvent[]; passages: SourcePassage[] };

export type BankItemList = { items: BankItem[]; total: number };

export type GenerateBankItemsResult = {
  items: BankItem[];
  /** Asked for vs. kept after the server's checks (the rest were discarded, never shown). */
  requested: number;
  discarded: number;
};

export type TopicCount = { topic: string; section: string | null; drafts: number; approved: number; rejected: number };
