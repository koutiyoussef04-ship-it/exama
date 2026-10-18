import type { Copy } from './types';

/** English — the original site copy. Facts must match the app (see src/data/content.ts). */
export const en: Copy = {
  meta: {
    title: 'Exama — Your AI Exam Coach',
    description: 'Turn your course material into personalized exams, grading, weak-topic practice and a study plan.',
    ogAlt: 'Exama — turn your course material into your personal AI exam coach.',
  },
  ui: { skip: 'Skip to content', menu: 'Menu', homeAria: 'Exama — home', language: 'Language', primaryNav: 'Primary', mobileNav: 'Mobile' },
  nav: { how: 'How it works', materials: 'Materials', pricing: 'Pricing', faq: 'FAQ', login: 'Log in' },
  cta: {
    trial: (days) => `Start your ${days}-day free trial`,
    free: 'Get started free',
    secondary: 'See how it works',
    choose: (plan) => `Choose ${plan}`,
    startFree: 'Start free',
  },
  hero: {
    eyebrow: 'AI exam preparation for students',
    titleStart: 'Turn your course material into your ',
    titleHighlight: 'personal AI exam coach.',
    lead: 'Upload your PDF, PowerPoint, audio or video. Exama turns your course material into personalized exams, grading, weak-topic practice and a study plan.',
    noteTrial: (days) => `${days} days free · Card required, no payment today · Cancel anytime before it ends`,
    noteFree: 'Free plan · No card needed',
    formatsAria: 'Supported material',
    formats: { pdf: 'PDF', slides: 'PowerPoint', audio: 'Audio', video: 'Video' },
    outputs: ['Personalized exams', 'Grading & feedback', 'Weak-topic practice', 'Study plan'],
    flowAria: 'Diagram: your PDF, PowerPoint, audio and video go into Exama, which turns them into personalized exams, grading, weak-topic practice and a study plan.',
    flowIn: 'Your course material',
    flowCore: 'Exama understands it',
    flowCoreSub: 'Topics, key points and definitions from your own material',
    flowOut: 'What you get',
  },
  how: {
    eyebrow: 'How it works',
    title: 'From course material to exam-ready, in six steps',
    steps: [
      { title: 'Upload', text: 'Add a PDF, PowerPoint, audio or video from your course.', icon: 'upload' },
      { title: 'Exama understands your material', text: 'It reads or transcribes everything and maps the topics your course covers.', icon: 'sparkle' },
      { title: 'Take a personalized exam', text: 'Get multiple-choice and short-answer questions written from your material.', icon: 'exam' },
      { title: 'Get graded', text: 'See your score and feedback on every answer, with the passage it came from.', icon: 'graded' },
      { title: 'Practice weak topics', text: 'Exama tracks each topic from your results and builds practice around the ones you are missing.', icon: 'target' },
      { title: 'Follow your study plan', text: 'A day-by-day plan up to your exam date that adapts as you study.', icon: 'calendar' },
    ],
  },
  materials: {
    eyebrow: 'Supported material',
    title: 'Bring whatever your course is made of',
    lead: 'PDFs, slides, lecture recordings and lecture videos all feed the same course. Your exams, practice and study plan use everything you add.',
    items: [
      { name: 'PDF', icon: 'pdf', formats: '.pdf', text: 'Lecture notes, textbook chapters, typed notes. Works best with selectable text — scanned or image-only PDFs are not supported yet.' },
      { name: 'PowerPoint', icon: 'slides', formats: '.pptx', text: 'Your lecture slides. Slides that are only images are not supported yet. Got an old .ppt? Save it as .pptx or PDF first.' },
      { name: 'Audio', icon: 'audio', formats: 'MP3 · M4A · WAV', text: 'Lecture recordings. Exama transcribes the lecture, then finds the topics it teaches.' },
      { name: 'Video', icon: 'video', formats: 'MP4 · MOV', text: 'Lecture videos. Exama uses what is said — slides or diagrams that are shown but never spoken are not captured.' },
    ],
    fineTrial: 'Audio and video lectures are included with Student and Pro, including during their free trial. Free includes one lecture per account. Basic covers PDFs and PowerPoints.',
    fineFree: 'Audio and video lectures are included with Student and Pro. Free includes one lecture per account. Basic covers PDFs and PowerPoints.',
  },
  grounded: {
    eyebrow: 'Source-based learning',
    title: 'Your material, not generic AI',
    lead: 'Exama does not quiz you on whatever an AI happens to know. It builds questions and practice from what your course actually teaches — your slides, your notes, your lectures.',
    points: [
      'Every question is checked against your material. If it cannot be traced back to a passage, it is discarded.',
      'Your results show the passage each question came from, so you can see where an answer comes from.',
      'Lectures are transcribed and analysed the same way as documents.',
      'Study in English, Spanish, French or Arabic — even when your material is in another language.',
    ],
    disclaimer: 'Exama is AI and can make mistakes. Double-check important facts against your course.',
    contrastAria: 'Generic questions compared with Exama questions',
    genericLabel: 'Generic questions',
    genericText: 'Written from general knowledge. They can cover things your lecturer never taught.',
    examaLabel: 'Exama questions',
    examaText: 'Written from your slides, notes and lectures — each one tied to a passage of your material.',
    sourceNote: 'Source passage shown with your results',
  },
  exams: {
    eyebrow: 'Personalized exams',
    title: 'An exam built from your course',
    lead: 'Pick a course and Exama writes the exam from your material. Answer the questions, submit, and get graded.',
    pipelineAria: 'How an exam works',
    steps: ['Upload material', 'Exama creates an exam', 'You answer', 'You get graded'],
    details: [
      { title: 'Two question types', text: 'Multiple-choice and short-answer questions. You choose how long the exam is.', icon: 'exam' },
      { title: 'Graded with feedback', text: 'Multiple-choice is marked instantly. Short answers are judged against your source material, with feedback on each one.', icon: 'graded' },
      { title: 'See the source', text: 'Each result shows the passage of your material the question was written from.', icon: 'quote' },
      { title: 'In your language', text: 'Study in English, Spanish, French or Arabic, independent of the language of your material.', icon: 'globe' },
    ],
  },
  weak: {
    eyebrow: 'Weak topics & targeted practice',
    title: 'Find what you don’t know yet — and fix it',
    lead: 'Every graded answer updates how well you know that topic. Exama flags your weak topics and builds practice around them, plus follow-up exams that focus on the topics and mistakes that need work.',
    loopAria: 'The study loop',
    steps: ['Study', 'Test', 'Find weak areas', 'Practice them', 'Improve'],
    back: 'and around again',
    fineTrial: 'Weak-topic analysis and adaptive practice are part of Student and Pro, including during their free trial. Free and Basic practice across all the topics of your course.',
    fineFree: 'Weak-topic analysis and adaptive practice are part of Student and Pro. Free and Basic practice across all the topics of your course.',
  },
  plan: {
    eyebrow: 'Personalized study plan',
    title: 'A study plan that knows your exam date',
    lead: 'Tell Exama when your exam is, how many minutes a day you can study and how prepared you feel. It plans every day until the exam from your course material and your results.',
    inputsTitle: 'What feeds your plan',
    inputs: [
      { title: 'Your course material', text: 'The topics your course covers and how important they are.', icon: 'folder' },
      { title: 'Your results', text: 'Which topics you know and which you keep missing.', icon: 'chart' },
      { title: 'Your schedule', text: 'Your exam date, minutes per day and the days you can study.', icon: 'clock' },
    ],
    outputsTitle: 'What you get',
    outputs: [
      'A plan for every day until your exam.',
      'Learn, practice, review, then a final review — more time for weaker and more important topics.',
      'It re-plans when you complete, skip or miss a task.',
      'Today’s tasks and your progress, in one place.',
    ],
    fineTrial: 'The plan that adapts to your results is part of Student and Pro, including during their free trial. Free and Basic include a planner that spreads your topics evenly.',
    fineFree: 'The plan that adapts to your results is part of Student and Pro. Free and Basic include a planner that spreads your topics evenly.',
  },
  product: {
    eyebrow: 'Inside Exama',
    title: 'Everything you need, in one app',
    lead: 'Your materials, your exams, your results, your weak topics and your study plan — all built from the same course.',
    areas: [
      { id: 'materials', title: 'Course materials', text: 'Every PDF, slideshow and lecture of a course in one place, with the topics each one covers.', icon: 'folder', alt: 'The course materials screen in Exama' },
      { id: 'exams', title: 'Exams', text: 'Generate an exam from a course, answer the questions and submit.', icon: 'exam', alt: 'An exam in Exama' },
      { id: 'results', title: 'Results', text: 'Your score, feedback on every answer and the source passage.', icon: 'graded', alt: 'The results screen in Exama' },
      { id: 'weak-topics', title: 'Weak topics', text: 'Topic-by-topic progress with your weak areas flagged.', icon: 'target', alt: 'The weak topics screen in Exama' },
      { id: 'planner', title: 'Study planner', text: 'Today’s tasks and your plan up to exam day.', icon: 'calendar', alt: 'The study planner in Exama' },
    ],
  },
  pricing: {
    eyebrow: 'Pricing',
    titleTrial: (days) => `Start with ${days} days free`,
    titleFree: 'Start free, upgrade when you need more',
    leadTrial: (days) => `Try the plan you choose free for ${days} days, with full access to everything it includes. No payment today, and you can cancel any time before the trial ends.`,
    leadFree: 'Use Exama on the Free plan at no cost and without a card. Paid plans add more courses, lectures and adaptive practice.',
    recommended: 'Recommended',
    perMonth: '/month',
    orYearly: (yearly, pct) => `or ${yearly}/year · save ${pct}%`,
    zero: '€0',
    noPayment: 'No payment needed',
    plans: {
      free: {
        name: 'Free',
        tagline: 'Try Exama on one course.',
        features: [{ text: 'PDFs and PowerPoints (.pptx)' }, { text: 'Exams, practice and a study planner' }, { text: '1 course at a time' }, { text: '1 audio or video lecture per account' }],
      },
      basic: {
        name: 'Basic',
        tagline: 'PDFs and PowerPoints.',
        features: [{ text: 'PDFs and PowerPoints (.pptx)' }, { text: 'Exams, practice and a study planner' }, { text: 'Up to 3 courses at once' }, { text: 'No audio or video lectures', off: true }],
      },
      student: {
        name: 'Student',
        tagline: 'All your material, personalized learning.',
        features: [
          { text: 'Everything in Basic' },
          { text: 'Audio and video lectures' },
          { text: 'Weak-topic analysis and adaptive practice' },
          { text: 'Study plan that adapts to your results' },
          { text: 'Up to 15 courses at once' },
        ],
      },
      pro: {
        name: 'Pro',
        tagline: 'Maximum AI usage.',
        features: [{ text: 'Everything in Student, with much higher allowances' }, { text: 'Up to 50 courses at once' }, { text: 'Highest AI usage allowance' }],
      },
    },
    fineTrial: (days) =>
      `Prices are list prices in euros. On the web you pay by card through Stripe and manage or cancel any time from Account → Manage billing. You enter a payment method at checkout, but nothing is charged today: after the ${days}-day trial your chosen plan begins unless you cancel before it ends. If you subscribe in a mobile app instead, the App Store or Google Play bills you and shows the price for your country. A subscription started anywhere unlocks your account everywhere.`,
    fineFree: 'Prices are list prices in euros. The plans screen in the Exama app shows the plans you can choose for your account and how they are billed. A subscription started anywhere unlocks your account everywhere.',
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Frequently asked questions',
    items: (trial, days) => [
      {
        q: 'What can I upload to Exama?',
        a: [
          'PDFs, PowerPoint presentations (.pptx), audio recordings (MP3, M4A, WAV) and videos (MP4, MOV). You can mix them in one course — everything you add feeds the same exams, practice and study plan.',
          trial
            ? 'Audio and video lectures are included with Student and Pro, including during their free trial. Free includes one lecture per account; Basic covers PDFs and PowerPoints.'
            : 'Audio and video lectures are included with Student and Pro. Free includes one lecture per account; Basic covers PDFs and PowerPoints.',
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
          trial
            ? 'Lectures are part of Student and Pro, including during their free trial; Free includes one lecture per account, using the first 45 minutes of it.'
            : 'Lectures are part of Student and Pro; Free includes one lecture per account, using the first 45 minutes of it.',
        ],
      },
      ...(trial
        ? [
            {
              q: `How does the ${days}-day free trial work?`,
              a: [
                `Every account can start one ${days}-day free trial. Create your Exama account at app.exama.app, choose Basic, Student or Pro, and start the trial at checkout. During the trial you have full access to the plan you pick, with everything it includes.`,
                `You enter a payment method at checkout (handled by Stripe), but nothing is charged today. If you do nothing, your chosen plan starts automatically when the ${days} days end. Cancel any time before then from Account → Manage billing and you will not be charged.`,
                'Already have an account? Log in and choose your plan — the trial is offered if your account has not used it yet. The trial works in any browser. A subscription started in a mobile app, where available, is billed by the App Store or Google Play and unlocks the same account.',
              ],
            },
            {
              q: 'What happens after the trial?',
              a: [
                `When the ${days} days end, the plan you chose begins and your card is charged its price — unless you cancel before the trial ends. If you cancel during the trial, you move to the Free plan as soon as the cancellation is confirmed and keep your courses and progress.`,
                'After that you can cancel or change plan any time from Account → Manage billing; a cancelled plan keeps working until the end of the period you paid for.',
              ],
            },
          ]
        : [
            {
              q: 'Can I use Exama for free?',
              a: [
                'Yes. The Free plan costs nothing and needs no card: one course at a time, PDFs and PowerPoints, exams, practice and a study planner, and one audio or video lecture per account.',
                'Create your account at app.exama.app, or log in if you already have one.',
              ],
            },
            {
              q: 'How do I choose a paid plan?',
              a: [
                'Sign in to the Exama app and open the plans screen (from Account, or from any upgrade button). It shows the plans you can choose for your account, their price and how they are billed. Your courses and progress stay with your account whichever plan you use.',
              ],
            },
          ]),
      {
        q: 'Is Exama only for PDF files?',
        a: ['No. PDFs are just one option. Exama also works with PowerPoint presentations, audio recordings and videos — all in the same course.'],
      },
    ],
  },
  final: {
    title: 'Put your course material to work.',
    text: 'Upload it once. Get exams, grading, weak-topic practice and a study plan built from it.',
    noteTrial: (days) => `${days} days free · Card required, no payment today · Cancel anytime before it ends`,
    noteFree: 'Free plan · No card needed · Already have an account? Log in',
  },
  footer: {
    tagline: 'Your AI exam coach, built from your own course material.',
    openApp: 'Open the Exama app',
    product: 'Product',
    legalHelp: 'Legal & help',
    account: 'Account',
    links: { how: 'How it works', materials: 'Supported material', pricing: 'Pricing', faq: 'FAQ', privacy: 'Privacy', terms: 'Terms', support: 'Support', login: 'Log in', signup: 'Create an account' },
  },
  support: {
    title: 'Support',
    description: 'Get help with Exama.',
    intro: 'Questions, problems or feedback? In the Exama app, open Account → Help & support for answers to common questions and to get in touch.',
    openApp: 'Open the Exama app',
    emailLead: 'You can also email us at',
    noEmail: 'A support email address will be listed here before launch.',
    faqLead: 'Looking for an answer about uploads, exams or plans?',
    faqLink: 'See the frequently asked questions',
    back: '← Back to exama.app',
  },
};
