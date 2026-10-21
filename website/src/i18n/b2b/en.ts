/**
 * English copy of the "for organizations" pages (/for-organizations, /for-organizations/demo).
 * Only what the workspace demonstrably does (apps/mobile/src/app/org/*, apps/api/src/routes/orgs.ts).
 * No customer names, logos, testimonials, counts, statistics, time savings or guarantees.
 */
import type { OrgCopy } from './types';

const n = (v: number) => new Intl.NumberFormat('en-IE', { useGrouping: 'always' }).format(v);

export const enOrg: OrgCopy = {
  meta: {
    title: 'Exama for organizations — Test questions from your own course material',
    description:
      'For universities, schools, training centers and companies: upload your course material, get AI-drafted questions with their source, review and approve them as a team, export to Moodle or CSV. Free 30-day pilot.',
    demoTitle: 'Request a demo — Exama for organizations',
    ogAlt: 'Exama for organizations: test questions from your own course material, each one with its source',
    demoDescription: 'Ask for a walkthrough of the Exama organization workspace by email, or start the free 30-day pilot yourself.',
  },
  nav: { how: 'How it works', pricing: 'Pricing', faq: 'FAQ', students: 'For students', demo: 'Demo' },
  cta: { pilot: (days) => `Start the free ${days}-day pilot`, pilotShort: 'Start the free pilot', demo: 'Request a demo', seeHow: 'See how it works' },
  hero: {
    eyebrow: 'For universities, schools, training centers and companies',
    titleStart: 'Turn your course material into test questions, ',
    titleHighlight: 'each one with its source.',
    lead: 'Upload a PDF or PowerPoint. Exama drafts the questions and shows the passage each one comes from. Your team reviews and approves every question before it is used, then exports them to Moodle or CSV.',
    note: (days) => `Free for ${days} days · No card · Nothing is charged automatically`,
    trustAria: 'How your material is handled',
    trust: ['Stored in the EU (Frankfurt)', 'Only your organization sees its material', 'Nothing approved without a reviewer', 'Export at any time: Moodle GIFT or CSV'],
    shotAlt: 'The Exama review screen: the source passage from the course next to the drafted question, with approve and reject controls',
    flowAria: 'From course material to a reviewed question bank: material in, drafts with their source, review by your team, export',
    flowIn: 'Your material',
    inputs: ['Course PDFs', 'PowerPoint slides'],
    flowCore: 'Drafts with their source',
    flowCoreSub: 'Each question quotes the passage it is based on',
    flowOut: 'After your review',
    outputs: ['Approved question bank', 'Moodle GIFT export', 'CSV export'],
  },
  audiences: {
    eyebrow: 'Who it is for',
    title: 'Every kind of organization, one workspace',
    lead: 'When you create the organization you say what kind it is: university or higher education, school, training center, company, tutoring or exam preparation. The workspace is the same for all of them.',
    items: [
      {
        title: 'Universities and schools',
        text: 'For courses taught from your own syllabus, where teaching staff keep control of every question.',
        icon: 'building',
        points: ['Multiple-choice and short-answer questions', 'Questions organized by module and topic within each course', 'Every question shows the passage it is based on'],
      },
      {
        title: 'Training centers and companies',
        text: 'For professional courses and employee training built from your own modules.',
        icon: 'folder',
        points: ['Drafts from PDFs and PowerPoint slides', 'Reviewed and approved by your team before use', 'Exports that drop into Moodle or your own tools'],
      },
      {
        title: 'Tutoring and exam preparation',
        text: 'For centers preparing students for exams, where practice must follow the material closely.',
        icon: 'target',
        points: ['Questions that stay within the uploaded material', 'Approve, reject or edit each draft', 'Reviewers at no cost, on every plan'],
      },
    ],
  },
  how: {
    eyebrow: 'How it works',
    title: 'From a course file to an approved question bank',
    lead: 'Four steps, all inside the organization workspace at app.exama.app.',
    steps: [
      { title: 'Upload a course', text: 'A PDF or PowerPoint (.pptx) with real text. Exama reads it, splits it into pages or slides and finds its topics.', icon: 'upload' },
      { title: 'Draft questions', text: 'Ask for up to 20 drafts at a time, for the whole course or one topic. Each draft comes with the quoted passage, its page or slide and automatic checks.', icon: 'sparkle' },
      { title: 'Review as a team', text: 'The review queue shows the source next to the question. Reviewers edit, approve or reject — one by one, with keyboard shortcuts on a desktop.', icon: 'graded' },
      { title: 'Export what was approved', text: 'Only approved questions leave the workspace: Moodle GIFT or CSV, for one course, one topic or everything.', icon: 'export' },
    ],
  },
  review: {
    eyebrow: 'Grounded, then reviewed',
    title: 'Every question shows where it comes from',
    lead: 'Drafts are written from your material only — not from what a model remembers about the subject. Then your team decides.',
    points: [
      'The quoted passage is located in your course, with its page or slide, and highlighted next to the question.',
      'Automatic checks flag drafts whose quote could not be found or only roughly matches, answers with numbers that are not in the passage, and weak multiple-choice distractors.',
      'A second check reads the located passage and says whether it supports the answer — advisory, shown to the reviewer.',
      'Nothing is approved automatically. A reviewer approves every question that enters the bank.',
    ],
    screens: [
      { id: 'org-review', title: 'Side-by-side review', text: 'Source passage on the left, editable question on the right. Approve, reject, or approve and move to the next.', icon: 'quote', alt: 'The Exama review screen: the quoted source passage next to the editable question, with approve and reject controls' },
      { id: 'org-queue', title: 'Review queue', text: 'Drafts in a searchable table, filtered by course and topic, with the ones that need attention first.', icon: 'search', alt: 'The Exama review queue: a table of draft questions with search, course and topic filters' },
      { id: 'org-dashboard', title: 'Dashboard and usage', text: 'Courses, drafts to review, approved questions and members at a glance — and how much of the plan is used.', icon: 'chart', alt: 'The Exama organization dashboard with counts of courses, drafts, approved questions and members, and usage against the plan' },
    ],
  },
  team: {
    eyebrow: 'Your team',
    title: 'Roles that match how a question bank gets made',
    lead: 'Every member signs in with their own account, so each approval carries a name.',
    roles: [
      { name: 'Admin', text: 'Adds and removes members, changes roles and settings — and does everything an editor does.' },
      { name: 'Editor', text: 'Uploads courses, drafts questions, adds questions by hand, exports and deletes.' },
      { name: 'Reviewer', text: 'Reads, edits, approves and rejects questions. Nothing else.' },
    ],
    reviewersNote: 'Plans count admins and editors. Reviewers are unlimited on every plan.',
    usageTitle: 'Usage you can see',
    usageText: 'The dashboard shows courses uploaded and question drafts generated against your plan. The workspace stops at the limit; it never charges for more.',
  },
  pricing: {
    eyebrow: 'Pricing',
    title: 'Start with a free pilot. Choose a plan when it fits.',
    lead: 'Plans are activated by Exama for your organization after you request one. There is no online checkout and nothing is charged automatically.',
    perMonth: '/month',
    plusVat: '+ VAT',
    orYearly: (yearly, pct) => `or ${yearly}/year + VAT (save ${pct}%)`,
    pilotPrice: 'Free',
    pilotDuration: (days) => `for ${days} days`,
    custom: 'Custom',
    customSub: 'pricing and allowances',
    plans: {
      pilot: {
        name: 'Pilot',
        tagline: 'Try the whole workspace with your own material.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} courses`, `${n(l!.itemsPerMonth)} question drafts in total`, `${n(l!.maxMembers)} admins or editors`, 'Unlimited reviewers', `Up to ${n(perRequest)} drafts per request`, 'Moodle GIFT and CSV export'],
        cta: 'Start the free pilot',
      },
      esencial: {
        name: 'Esencial',
        tagline: 'For one center or department.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} course uploads per month`, `${n(l!.itemsPerMonth)} question drafts per month`, `${n(l!.maxMembers)} admins or editors`, 'Unlimited reviewers', `Up to ${n(perRequest)} drafts per request`, 'Moodle GIFT and CSV export'],
        cta: 'Request Esencial',
      },
      profesional: {
        name: 'Profesional',
        tagline: 'For several courses running at once.',
        features: (l, perRequest) => [`${n(l!.coursesPerMonth)} course uploads per month`, `${n(l!.itemsPerMonth)} question drafts per month`, `${n(l!.maxMembers)} admins or editors`, 'Unlimited reviewers', `Up to ${n(perRequest)} drafts per request`, 'Moodle GIFT and CSV export'],
        cta: 'Request Profesional',
      },
      centro: {
        name: 'Centro',
        tagline: 'For centers with their own volumes.',
        features: () => ['Course and draft allowances set with you', 'Admin and editor seats set with you', 'Unlimited reviewers', 'Moodle GIFT and CSV export'],
        cta: 'Talk to us',
      },
    },
    vatNote: 'Prices exclude VAT. VAT is added at the applicable rate when the plan is invoiced.',
    billingNote: 'The pilot needs no card. Paid plans are agreed by email and activated by Exama; you are never charged without having asked for a plan.',
  },
  pilot: {
    eyebrow: 'The pilot',
    title: (days) => `${days} days to try it with your own courses`,
    lead: 'The pilot starts the moment the organization account is created. It is the full workspace, with these allowances for the whole pilot:',
    includes: (l, perRequest) => [`${n(l.coursesPerMonth)} courses`, `${n(l.itemsPerMonth)} question drafts in total`, `${n(l.maxMembers)} admins or editors, unlimited reviewers`, `Up to ${n(perRequest)} drafts per request`],
    startTitle: 'How the pilot starts',
    start: ['Create the organization account: its name, its type, your name and email.', 'Confirm your email with the link we send you.', 'Upload a course and ask for your first drafts. Add colleagues as editors or reviewers once they have an Exama account.'],
    afterTitle: 'When the pilot ends',
    after: [
      'Nothing is charged and nothing is deleted.',
      'Your team can keep reading, reviewing and exporting every course and question.',
      'New courses and new drafts wait until a plan is activated for the organization.',
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Questions organizations ask',
    items: (days) => [
      {
        q: 'What can we upload?',
        a: ['PDF and PowerPoint (.pptx) files that contain real text. Scanned images without a text layer cannot be read. Each course is one file; you can upload as many courses as your plan allows.'],
      },
      {
        q: 'What counts as a question draft?',
        a: [
          'A draft is one question Exama writes and keeps for your review. You ask for a number of drafts (up to 20 per request) and only the ones delivered count against your allowance. Questions your editors add by hand do not count.',
          `On the pilot the allowance is a total for the ${days} days; on Esencial and Profesional it is per calendar month.`,
        ],
      },
      {
        q: 'Are the questions based on our material?',
        a: [
          'Yes. Drafts are written only from the text of the course you uploaded, and each one quotes the passage it is based on, with its page or slide. Drafts whose quote cannot be found in the material are flagged for the reviewer.',
          'It is still a draft: a reviewer reads, edits if needed and approves it before it enters the bank.',
        ],
      },
      {
        q: 'Can we edit questions, or write our own?',
        a: ['Yes. Reviewers can edit any draft before approving it. Editors can add questions by hand; they go through the same review queue as the drafted ones.'],
      },
      {
        q: 'How do we get the questions into Moodle?',
        a: ['Export approved questions as a Moodle GIFT file and import it into a question bank in Moodle. A CSV export is also available for other tools. Exports include approved questions only, for one course, one topic or everything.'],
      },
      {
        q: 'Where is our material stored, and who sees it?',
        a: [
          'Courses, questions and accounts are stored on servers in the European Union (Frankfurt). Only members of your organization can see its material. To draft and check questions, the relevant passages are sent to a third-party AI provider (Anthropic); Exama uses your material only to draft and check questions for your organization.',
          'Organization-specific terms and a data processing agreement are being finalized; ask us when you request a plan.',
        ],
      },
      {
        q: 'What happens after the pilot?',
        a: [`After ${days} days, nothing is charged and nothing is deleted. Your team can still read, review and export everything. To upload new courses or draft new questions, request a plan and we activate it for your organization.`],
      },
      {
        q: 'How is a plan paid?',
        a: ['Request Esencial, Profesional or Centro by email. We agree the plan and billing period with you and activate it; prices exclude VAT. There is no online checkout, and nothing is charged automatically — not after the pilot, not at renewal.'],
      },
    ],
  },
  final: {
    title: 'Try it with one of your courses.',
    text: 'Create the organization account, upload a course and review the first drafts with your team.',
    note: 'Free for 30 days. No card. Your material stays yours.',
  },
  demo: {
    title: 'Request a demo',
    intro: 'Tell us about your organization and we will reply by email to arrange a walkthrough of the workspace, answer your questions or set up a plan.',
    includeTitle: 'Helpful to include',
    include: ['Your organization and what it teaches (university or school courses, professional training, employee training, exam preparation…)', 'How many courses or modules you would start with, and in what format', 'How many people would upload, draft and review questions', 'Which plan you are considering, or what you would need from Centro'],
    emailButton: 'Email examaweb@gmail.com',
    emailHow: 'The button opens your email app with a pre-filled message. If it does not, write to the address below.',
    addressLead: 'Our address for organizations:',
    subject: 'Exama for organizations — demo request',
    body: 'Hello Exama,\n\nWe would like a demo of the organization workspace.\n\nOrganization:\nWhat we teach:\nCourses or modules to start with:\nPeople who would review questions:\nPlan we are considering:\n\nThank you,\n',
    replyNote: 'We reply by email. No account is created and nothing is charged by asking.',
    orTitle: 'Prefer to try it yourself?',
    orText: (days) => `The ${days}-day pilot is free and starts as soon as the organization account is created — no demo needed.`,
    back: '← Back to Exama for organizations',
  },
  footer: {
    tagline: 'Test questions from your own course material, each with its source, reviewed by your team.',
    product: 'For organizations',
    account: 'Account',
    how: 'How it works',
    pricing: 'Pricing',
    faq: 'FAQ',
    demo: 'Request a demo',
    signup: 'Create an organization account',
    students: 'Exama for students',
  },
};
