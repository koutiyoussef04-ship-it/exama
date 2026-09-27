/**
 * Two layers:
 *  - LLMProvider: the only vendor-specific code (Anthropic today; OpenAI/Gemini/etc. = one new file).
 *  - StudyAI: the study-domain operations the app needs. The real implementation
 *    (LLMStudyAI) builds prompts and validates JSON over any LLMProvider; MockStudyAI
 *    returns deterministic results so the app runs offline and tests need no API key.
 */
import type { QuestionType } from '@study/shared';

export interface LLMProvider {
  readonly name: string;
  /** Returns the model's raw text reply. */
  complete(input: { system: string; prompt: string; maxTokens?: number }): Promise<string>;
}

export type DocumentAnalysis = {
  summary: string;
  topics: string[]; // 3-10 short topic names
  /** Detected main language of the material (ISO 639-1), or null if unclear. */
  sourceLanguage: string | null;
};

/**
 * Output language for an AI call: an ISO 639-1 code ("es"), or "source" (analysis only) =
 * write in the material's own language.
 */
export type AnalyzeOptions = { language: string };

export type GeneratedQuestion = {
  type: QuestionType;
  topic: string;
  prompt: string;
  options: string[] | null;
  correctAnswer: string;
  explanation: string;
  /** Verbatim excerpt from the course material supporting the answer (checked by the exam service). */
  sourceQuote: string;
};

export type MissedQuestion = { topic: string; prompt: string; userAnswer: string; correctAnswer: string };

export type GenerateQuestionsInput = {
  excerpts: string[];
  topics: string[];
  count: number;
  /** For follow-up exams: topics to target and what the student got wrong before. */
  focusTopics?: string[];
  missed?: MissedQuestion[];
  /** ISO 639-1 language to write questions, options, answers and explanations in. */
  language: string;
};

export type ShortAnswerToGrade = {
  id: string;
  prompt: string;
  correctAnswer: string;
  /** Course-material excerpt the grader must judge against. */
  sourceQuote: string;
  userAnswer: string;
};

export type ShortAnswerGrade = { id: string; score: number; feedback: string };

/** Study planner: how central each topic is and what to focus on (plan text in `language`). */
export type TopicPlanInput = {
  topics: string[];
  summary: string;
  /** Representative excerpts of the material (grounding). */
  excerpts: string[];
  /** ISO 639-1 language for the focus notes. */
  language: string;
};
export type TopicPlanItem = { topic: string; importance: number; focus: string };

/**
 * Structured knowledge from one course material (a lecture transcript or an extra PDF).
 * The output is validated and grounded by the materials service (every topic needs a verbatim
 * quote that really occurs in the material) before anything reaches the course.
 */
export type KnowledgeExtractionInput = {
  /** The material's text (transcript paragraphs or PDF text), in its original language. */
  text: string;
  kind: 'pdf' | 'audio' | 'video';
  /** The course's current topic names — reused exactly when the material covers them. */
  existingTopics: string[];
  /** ISO 639-1 language for NEW topic names (the course's topic language, so names stay consistent). */
  topicLanguage: string;
  /** ISO 639-1 language for the summary and notes, or "source" = the material's own language. */
  language: string;
};
export type ExtractedTopic = {
  name: string;
  subtopics: string[];
  keyPoints: string[];
  definitions: { term: string; definition: string }[];
  examples: string[];
  examConcepts: string[];
  relatedTopics: string[];
  sourceQuote: string;
};
export type KnowledgeExtraction = {
  /** Detected main language of the material (ISO 639-1), or null. */
  sourceLanguage: string | null;
  summary: string;
  topics: ExtractedTopic[];
};

export interface StudyAI {
  analyzeDocument(text: string, options: AnalyzeOptions): Promise<DocumentAnalysis>;
  generateQuestions(input: GenerateQuestionsInput): Promise<GeneratedQuestion[]>;
  /** `language`: ISO 639-1 language for the feedback. Students may answer in any language. */
  gradeShortAnswers(items: ShortAnswerToGrade[], options: { language: string }): Promise<ShortAnswerGrade[]>;
  /** Topic importance (1-3) + focus notes for the study planner. The schedule itself is computed without AI. */
  planTopics(input: TopicPlanInput): Promise<TopicPlanItem[]>;
  /** Topics, concepts, definitions, examples and likely exam concepts from one added material. */
  extractKnowledge(input: KnowledgeExtractionInput): Promise<KnowledgeExtraction>;
}
