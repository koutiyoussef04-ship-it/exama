/**
 * Exam screen helpers — pure (no React Native) so they are unit tested.
 */

/** Option markers: Latin letters, or the Arabic abjad order for an Arabic exam (أ ب ج د هـ و). */
const LATIN = ['A', 'B', 'C', 'D', 'E', 'F'];
const ARABIC = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];

/** The marker for option `i`, in the exam's own script (the content language, not the app language). */
export function optionLetter(i: number, contentLanguage: string | null | undefined): string {
  const set = contentLanguage === 'ar' ? ARABIC : LATIN;
  return set[i] ?? String(i + 1);
}

export const isAnswered = (value: string | undefined) => !!value?.trim();

/** Words typed so far (any script; runs of whitespace separate words). */
export function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/u).length : 0;
}

export type QuestionState = 'current' | 'answered' | 'unanswered';

/** One state per question, for the progress segments and the question map. */
export function questionStates(ids: string[], answers: Record<string, string>, index: number): QuestionState[] {
  return ids.map((id, i) => (i === index ? 'current' : isAnswered(answers[id]) ? 'answered' : 'unanswered'));
}

/** The next unanswered question after `index` (wrapping around), or null when every question has an answer. */
export function nextUnanswered(ids: string[], answers: Record<string, string>, index: number): number | null {
  for (let step = 1; step <= ids.length; step++) {
    const i = (index + step) % ids.length;
    if (!isAnswered(answers[ids[i]])) return i;
  }
  return null;
}
