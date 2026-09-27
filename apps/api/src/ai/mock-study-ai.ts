/**
 * Offline stand-in for the real AI. Deterministic, derived from the document text,
 * good enough to exercise the full app flow in development and tests.
 */
import type {
  AnalyzeOptions,
  DocumentAnalysis,
  GeneratedQuestion,
  GenerateQuestionsInput,
  KnowledgeExtraction,
  KnowledgeExtractionInput,
  ShortAnswerGrade,
  ShortAnswerToGrade,
  StudyAI,
  TopicPlanInput,
  TopicPlanItem,
} from './types.js';

const STOP = new Set(
  'the a an and or of to in on for is are was were be been with that this these those as by at from it its into which can will not but has have had their there such than then also may more most other some each any all one two'.split(
    ' ',
  ),
);

const words = (s: string) => s.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [];
const sentences = (s: string) =>
  s
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter((x) => x.length > 30 && x.length < 300);
const clip = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Crude detection, good enough for offline development: script + common function words. */
export function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 5000);
  if ((sample.match(/[\u0600-\u06FF]/g) ?? []).length > 20) return 'ar';
  const w = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (w.length < 5) return null;
  const score = (list: string[]) => w.filter((x) => list.includes(x)).length;
  const scores = {
    en: score(['the', 'and', 'of', 'is', 'are', 'with', 'which']),
    es: score(['el', 'los', 'las', 'y', 'es', 'del', 'que', 'una']),
    fr: score(['le', 'les', 'des', 'et', 'est', 'une', 'du', 'que']),
  };
  const [best, n] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : null;
}

/** Tiny phrasebook so mock output visibly follows the requested language. */
const PHRASES: Record<string, { mcq: (t: string) => string; short: (t: string) => string; states: string; key: string; good: string; partial: string; focus: string }> = {
  en: {
    mcq: (t) => `Which statement about "${t}" is taken from the material?`,
    short: (t) => `In your own words, explain what the material says about "${t}".`,
    states: 'The material states',
    key: 'Key point',
    good: 'Good — you covered the key ideas.',
    partial: 'Partially correct. Key idea:',
    focus: 'Focus on:',
  },
  es: {
    mcq: (t) => `¿Qué afirmación sobre «${t}» procede del material?`,
    short: (t) => `Explica con tus palabras lo que dice el material sobre «${t}».`,
    states: 'El material dice',
    key: 'Idea clave',
    good: 'Bien: has cubierto las ideas clave.',
    partial: 'Parcialmente correcto. Idea clave:',
    focus: 'Céntrate en:',
  },
  fr: {
    mcq: (t) => `Quelle affirmation sur « ${t} » provient du support ?`,
    short: (t) => `Expliquez avec vos mots ce que dit le support sur « ${t} ».`,
    states: 'Le support indique',
    key: 'Point clé',
    good: 'Bien — vous avez couvert les idées clés.',
    partial: 'Partiellement correct. Idée clé :',
    focus: 'Concentrez-vous sur :',
  },
  ar: {
    mcq: (t) => `أي عبارة عن «${t}» مأخوذة من المادة؟`,
    short: (t) => `اشرح بكلماتك ما تقوله المادة عن «${t}».`,
    states: 'تقول المادة',
    key: 'الفكرة الأساسية',
    good: 'أحسنت، لقد غطّيت الأفكار الأساسية.',
    partial: 'إجابة صحيحة جزئيًا. الفكرة الأساسية:',
    focus: 'ركّز على:',
  },
};
const phrases = (lang: string) => PHRASES[lang] ?? PHRASES.en;
const tag = (lang: string) => `[mock${lang === 'en' ? '' : `:${lang}`}]`;

export class MockStudyAI implements StudyAI {
  async analyzeDocument(text: string, options: AnalyzeOptions): Promise<DocumentAnalysis> {
    const sourceLanguage = detectLanguage(text);
    const out = options.language === 'source' ? (sourceLanguage ?? 'en') : options.language;
    const freq = new Map<string, number>();
    for (const w of words(text)) if (!STOP.has(w) && w.length > 4) freq.set(w, (freq.get(w) ?? 0) + 1);
    const topics = [...freq.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([w]) => w[0].toUpperCase() + w.slice(1));
    const summary = sentences(text).slice(0, 2).join(' ') || clip(text, 300) || 'No text found.';
    // The mock can't translate: it tags the summary with the requested language instead.
    return { summary: out === 'en' ? summary : `${tag(out)} ${summary}`, topics: topics.length ? topics : ['General'], sourceLanguage };
  }

  async generateQuestions(input: GenerateQuestionsInput): Promise<GeneratedQuestion[]> {
    const pool = sentences(input.excerpts.join(' '));
    const topics = input.focusTopics?.length ? input.focusTopics : input.topics;
    const out: GeneratedQuestion[] = [];
    const p = phrases(input.language);
    for (let i = 0; i < input.count; i++) {
      const topic = topics[i % topics.length] ?? 'General';
      const related = pool.filter((s) => s.toLowerCase().includes(topic.toLowerCase()));
      const fact = related[i % Math.max(related.length, 1)] ?? pool[i % Math.max(pool.length, 1)] ?? `${topic} is covered in the material.`;
      if (i % 5 < 3 && pool.length >= 4) {
        const distractors = pool.filter((s) => s !== fact).slice(i, i + 3);
        while (distractors.length < 3) distractors.push(`None of the material discusses ${topic} (${distractors.length}).`);
        const correct = clip(fact);
        const options = [correct, ...distractors.map((d) => clip(d))];
        const rot = i % 4; // deterministic shuffle
        out.push({
          type: 'mcq',
          topic,
          prompt: `${tag(input.language)} ${p.mcq(topic)}`,
          options: [...options.slice(rot), ...options.slice(0, rot)],
          correctAnswer: correct,
          explanation: `${p.states}: "${clip(fact, 200)}"`,
          sourceQuote: fact,
        });
      } else {
        out.push({
          type: 'short_answer',
          topic,
          prompt: `${tag(input.language)} ${p.short(topic)}`,
          options: null,
          correctAnswer: fact,
          explanation: `${p.key}: "${clip(fact, 200)}"`,
          sourceQuote: fact,
        });
      }
    }
    return out;
  }

  async gradeShortAnswers(items: ShortAnswerToGrade[], options: { language: string }): Promise<ShortAnswerGrade[]> {
    const p = phrases(options.language);
    return items.map((it) => {
      const expected = new Set(words(it.correctAnswer).filter((w) => !STOP.has(w)));
      const given = new Set(words(it.userAnswer));
      const hit = [...expected].filter((w) => given.has(w)).length;
      const score = expected.size ? Math.min(1, hit / Math.max(3, expected.size * 0.6)) : 0;
      const rounded = Math.round(score * 100) / 100;
      return {
        id: it.id,
        score: rounded,
        feedback:
          rounded >= 0.7 ? `${tag(options.language)} ${p.good}` : `${tag(options.language)} ${p.partial} ${clip(it.correctAnswer, 160)}`,
      };
    });
  }

  /**
   * Existing course topics the text mentions are reused; up to three frequent new words become new
   * topics. Quotes are real sentences from the text, so they pass the grounding check.
   */
  async extractKnowledge(input: KnowledgeExtractionInput): Promise<KnowledgeExtraction> {
    const sourceLanguage = detectLanguage(input.text);
    const out = input.language === 'source' ? (sourceLanguage ?? 'en') : input.language;
    const pool = sentences(input.text);
    const lower = input.text.toLowerCase();
    const existing = input.existingTopics.filter((t) => lower.includes(t.toLowerCase()));
    const taken = new Set(existing.flatMap((t) => words(t)));
    const freq = new Map<string, number>();
    for (const w of words(input.text)) if (!STOP.has(w) && w.length > 5 && !taken.has(w)) freq.set(w, (freq.get(w) ?? 0) + 1);
    const fresh = [...freq.entries()]
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([w]) => w[0].toUpperCase() + w.slice(1));
    const topics = [...existing, ...fresh].slice(0, 8).map((name) => {
      const about = pool.filter((x) => x.toLowerCase().includes(name.toLowerCase()));
      const quote = about[0] ?? pool[0] ?? '';
      return {
        name,
        subtopics: [],
        keyPoints: about.slice(0, 2).map((x) => `${tag(out)} ${clip(x, 200)}`),
        definitions: about.filter((x) => / (is|are) /i.test(x)).slice(0, 1).map((x) => ({ term: name, definition: `${tag(out)} ${clip(x, 200)}` })),
        examples: [],
        examConcepts: [`${tag(out)} ${name}`],
        relatedTopics: existing.filter((t) => t !== name).slice(0, 2),
        sourceQuote: quote,
      };
    });
    const summary = pool.slice(0, 2).join(' ');
    return { sourceLanguage, summary: out === 'en' ? summary : `${tag(out)} ${summary}`, topics: pool.length ? topics : [] };
  }

  async planTopics(input: TopicPlanInput): Promise<TopicPlanItem[]> {
    const text = input.excerpts.join(' ').toLowerCase();
    const counts = input.topics.map((t) => text.split(t.toLowerCase()).length - 1);
    const max = Math.max(1, ...counts);
    const pool = sentences(input.excerpts.join(' '));
    const p = phrases(input.language);
    return input.topics.map((topic, i) => {
      const fact = pool.find((x) => x.toLowerCase().includes(topic.toLowerCase())) ?? topic;
      return {
        topic,
        importance: counts[i] >= max * 0.6 ? 3 : counts[i] > 0 ? 2 : 1,
        focus: `${tag(input.language)} ${p.focus} ${clip(fact, 150)}`,
      };
    });
  }
}
