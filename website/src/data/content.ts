/**
 * All marketing copy and product facts in one place.
 *
 * Source of truth for every product claim is the Exama application code, NOT this file:
 *   - prices, trial length, plan tiers ....... packages/shared/src/billing.ts
 *   - plan features and usage allowances ..... apps/api/src/billing/features.ts, limits.ts
 *   - supported formats ...................... packages/shared/src/materials.ts
 *   - how questions are grounded ............. apps/api/src/lib/grounding.ts
 *   - study planner .......................... README.md ("Study planner")
 * `npm run check:pricing` compares the prices below with billing.ts. If the app changes, update here.
 *
 * Rules for this file: no testimonials, no user counts, no ratings, no partner/university names,
 * no statistics. Only what the product demonstrably does.
 */
import { site } from '../config/site';

// ---------- Pricing (keep the `key: { monthlyCents, yearlyCents }` shape — scripts/check-pricing.mjs parses it) ----------

export const TRIAL_DAYS = 7;

export const PRICES = {
  basic: { monthlyCents: 999, yearlyCents: 7999 },
  student: { monthlyCents: 1499, yearlyCents: 11999 },
  pro: { monthlyCents: 2499, yearlyCents: 19999 },
} as const;

export const eur = (cents: number) => `€${(cents / 100).toFixed(2)}`;
/** Yearly saving vs 12 monthly payments, in whole percent — derived from PRICES, never typed by hand. */
export const yearlySavingPct = (tier: keyof typeof PRICES) => {
  const { monthlyCents, yearlyCents } = PRICES[tier];
  return Math.round(((monthlyCents * 12 - yearlyCents) / (monthlyCents * 12)) * 100);
};

export type PlanFeature = { text: string; off?: boolean };
export type PlanCard = {
  id: 'free' | 'basic' | 'student' | 'pro';
  name: string;
  tagline: string;
  /** null = Free. */
  price: { monthly: string; yearly: string; savingPct: number } | null;
  recommended?: boolean;
  features: PlanFeature[];
  cta: string;
};

const paid = (tier: keyof typeof PRICES) => ({
  monthly: eur(PRICES[tier].monthlyCents),
  yearly: eur(PRICES[tier].yearlyCents),
  savingPct: yearlySavingPct(tier),
});

export const plans: PlanCard[] = [
  {
    id: 'free',
    name: 'Free',
    tagline: 'Try Exama on one course.',
    price: null,
    features: [
      { text: 'PDFs and PowerPoints (.pptx)' },
      { text: 'Exams, practice and a study planner' },
      { text: '1 course at a time' },
      { text: '1 audio or video lecture per account' },
    ],
    cta: 'Start free',
  },
  {
    id: 'basic',
    name: 'Basic',
    tagline: 'PDFs and PowerPoints.',
    price: paid('basic'),
    features: [
      { text: 'PDFs and PowerPoints (.pptx)' },
      { text: 'Exams, practice and a study planner' },
      { text: 'Up to 3 courses at once' },
      { text: 'No audio or video lectures', off: true },
    ],
    cta: site.cta.label,
  },
  {
    id: 'student',
    name: 'Student',
    tagline: 'All your material, personalized learning.',
    price: paid('student'),
    recommended: true,
    features: [
      { text: 'Everything in Basic' },
      { text: 'Audio and video lectures' },
      { text: 'Weak-topic analysis and adaptive practice' },
      { text: 'Study plan that adapts to your results' },
      { text: 'Up to 15 courses at once' },
    ],
    cta: site.cta.label,
  },
  {
    id: 'pro',
    name: 'Pro',
    tagline: 'Maximum AI usage.',
    price: paid('pro'),
    features: [
      { text: 'Everything in Student, with much higher allowances' },
      { text: 'Up to 50 courses at once' },
      { text: 'Highest AI usage allowance' },
    ],
    cta: site.cta.label,
  },
];

// ---------- How it works ----------

export type Step = { title: string; text: string; icon: string };

export const steps: Step[] = [
  { title: 'Upload', text: 'Add a PDF, PowerPoint, audio or video from your course.', icon: 'upload' },
  { title: 'Exama understands your material', text: 'It reads or transcribes everything and maps the topics your course covers.', icon: 'sparkle' },
  { title: 'Take a personalized exam', text: 'Get multiple-choice and short-answer questions written from your material.', icon: 'exam' },
  { title: 'Get graded', text: 'See your score and feedback on every answer, with the passage it came from.', icon: 'graded' },
  { title: 'Practice weak topics', text: 'Exama tracks each topic from your results and builds practice around the ones you are missing.', icon: 'target' },
  { title: 'Follow your study plan', text: 'A day-by-day plan up to your exam date that adapts as you study.', icon: 'calendar' },
];

// ---------- Supported material ----------

export type MaterialType = { name: string; icon: string; formats: string; text: string };

export const materials: MaterialType[] = [
  {
    name: 'PDF',
    icon: 'pdf',
    formats: '.pdf',
    text: 'Lecture notes, textbook chapters, typed notes. Works best with selectable text — scanned or image-only PDFs are not supported yet.',
  },
  {
    name: 'PowerPoint',
    icon: 'slides',
    formats: '.pptx',
    text: 'Your lecture slides. Slides that are only images are not supported yet. Got an old .ppt? Save it as .pptx or PDF first.',
  },
  {
    name: 'Audio',
    icon: 'audio',
    formats: 'MP3 · M4A · WAV',
    text: 'Lecture recordings. Exama transcribes the lecture, then finds the topics it teaches.',
  },
  {
    name: 'Video',
    icon: 'video',
    formats: 'MP4 · MOV',
    text: 'Lecture videos. Exama uses what is said — slides or diagrams that are shown but never spoken are not captured.',
  },
];

// ---------- Your material, not generic AI ----------

export const groundedPoints: string[] = [
  'Every question is checked against your material. If it cannot be traced back to a passage, it is discarded.',
  'Your results show the passage each question came from, so you can see where an answer comes from.',
  'Lectures are transcribed and analysed the same way as documents.',
  'Study in English, Spanish, French or Arabic — even when your material is in another language.',
];

// ---------- Personalized exams ----------

export const examSteps = ['Upload material', 'Exama creates an exam', 'You answer', 'You get graded'] as const;

export const examDetails: { title: string; text: string; icon: string }[] = [
  { title: 'Two question types', text: 'Multiple-choice and short-answer questions. You choose how long the exam is.', icon: 'exam' },
  { title: 'Graded with feedback', text: 'Multiple-choice is marked instantly. Short answers are judged against your source material, with feedback on each one.', icon: 'graded' },
  { title: 'See the source', text: 'Each result shows the passage of your material the question was written from.', icon: 'quote' },
  { title: 'In your language', text: 'Study in English, Spanish, French or Arabic, independent of the language of your material.', icon: 'globe' },
];

// ---------- Weak topics + targeted practice ----------

export const loopSteps = ['Study', 'Test', 'Find weak areas', 'Practice them', 'Improve'] as const;

// ---------- Study plan ----------

export const planInputs: { title: string; text: string; icon: string }[] = [
  { title: 'Your course material', text: 'The topics your course covers and how important they are.', icon: 'folder' },
  { title: 'Your results', text: 'Which topics you know and which you keep missing.', icon: 'chart' },
  { title: 'Your schedule', text: 'Your exam date, minutes per day and the days you can study.', icon: 'clock' },
];

export const planOutputs: string[] = [
  'A plan for every day until your exam.',
  'Learn, practice, review, then a final review — more time for weaker and more important topics.',
  'It re-plans when you complete, skip or miss a task.',
  'Optional daily study reminders on iPhone and Android.',
];

// ---------- Product areas (real screenshots are dropped into /public/screenshots — see website/README.md) ----------

export type ProductArea = { id: string; title: string; text: string; icon: string; alt: string };

export const productAreas: ProductArea[] = [
  { id: 'materials', title: 'Course materials', text: 'Every PDF, slideshow and lecture of a course in one place, with the topics each one covers.', icon: 'folder', alt: 'The course materials screen in Exama' },
  { id: 'exams', title: 'Exams', text: 'Generate an exam from a course, answer the questions and submit.', icon: 'exam', alt: 'An exam in Exama' },
  { id: 'results', title: 'Results', text: 'Your score, feedback on every answer and the source passage.', icon: 'graded', alt: 'The results screen in Exama' },
  { id: 'weak-topics', title: 'Weak topics', text: 'Topic-by-topic progress with your weak areas flagged.', icon: 'target', alt: 'The weak topics screen in Exama' },
  { id: 'planner', title: 'Study planner', text: 'Today’s tasks and your plan up to exam day.', icon: 'calendar', alt: 'The study planner in Exama' },
];

// ---------- FAQ ----------

export type Faq = { q: string; a: string[] };

export const faqs: Faq[] = [
  {
    q: 'What can I upload to Exama?',
    a: [
      'PDFs, PowerPoint presentations (.pptx), audio recordings (MP3, M4A, WAV) and videos (MP4, MOV). You can mix them in one course — everything you add feeds the same exams, practice and study plan.',
      'Audio and video lectures are included with Student and Pro, and in the free trial. Free includes one lecture per account; Basic covers PDFs and PowerPoints.',
    ],
  },
  {
    q: 'How does Exama create my exams?',
    a: [
      'Exama first reads your material and maps the topics it teaches. When you ask for an exam, it writes multiple-choice and short-answer questions on those topics from your content. You choose the length, answer the questions and submit to get graded.',
    ],
  },
  {
    q: 'Are the questions based on my course material?',
    a: [
      'Yes. Questions are written from your own material, and each one has to be backed by a passage in it — a question that cannot be traced back to your material is discarded. Your results show the passage so you can check it.',
      'Exama is AI and can still make mistakes, so double-check important facts against your course.',
    ],
  },
  {
    q: 'Can Exama understand lectures?',
    a: [
      'Yes. Audio and video lectures are transcribed and analysed like any other material, and their topics join your course. Exama works from what is said: slides or diagrams that are shown on screen but not spoken are not captured.',
      'Lectures are part of Student and Pro and of the free trial; Free includes one lecture per account, using the first 45 minutes of it.',
    ],
  },
  {
    q: 'How does the 7-day free trial work?',
    a: [
      'Every account can start one 7-day free trial. Create your Exama account at app.exama.app, choose Basic, Student or Pro, and start the trial at checkout. It includes the Student features — lectures, weak-topic practice and an adaptive study plan — with a limited allowance.',
      'You enter a payment method at checkout (handled by Stripe), but nothing is charged today. If you do nothing, your chosen plan starts automatically when the 7 days end. Cancel any time before then from Account → Manage billing and you will not be charged.',
      'The trial works in any browser. A subscription started in a mobile app, where available, is billed by the App Store or Google Play and unlocks the same account.',
    ],
  },
  {
    q: 'What happens after the trial?',
    a: [
      'When the 7 days end, the plan you chose begins and your card is charged its price — unless you cancel before the trial ends. If you cancel, you move to the Free plan and keep your courses and progress.',
      'After that you can cancel or change plan any time from Account → Manage billing; a cancelled plan keeps working until the end of the period you paid for.',
    ],
  },
  {
    q: 'Is Exama only for PDF files?',
    a: [
      'No. PDFs are just one option. Exama also works with PowerPoint presentations, audio recordings and videos — all in the same course.',
    ],
  },
];

// ---------- Footer ----------

export const footerLinks = {
  product: [
    { label: 'How it works', href: '/#how-it-works' },
    { label: 'Supported material', href: '/#materials' },
    { label: 'Pricing', href: '/#pricing' },
    { label: 'FAQ', href: '/#faq' },
  ],
  legal: [
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'Support', href: '/support' },
  ],
} as const;

export const navLinks = [
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Materials', href: '/#materials' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'FAQ', href: '/#faq' },
] as const;
