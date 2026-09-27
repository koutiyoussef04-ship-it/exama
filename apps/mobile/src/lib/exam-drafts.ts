/**
 * In-memory drafts of in-progress exam answers, keyed by exam id.
 * Lets a student leave an exam (back gesture, checking the course) and resume
 * without losing answers. Cleared on submit; not persisted across app restarts.
 */
const drafts = new Map<string, Record<string, string>>();

export const examDrafts = {
  get: (examId: string) => drafts.get(examId) ?? {},
  set: (examId: string, answers: Record<string, string>) => drafts.set(examId, answers),
  clear: (examId: string) => drafts.delete(examId),
};
