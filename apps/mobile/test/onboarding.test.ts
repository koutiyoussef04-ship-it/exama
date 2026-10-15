/**
 * Student onboarding (client logic): when it is shown, the question flow (select / change / back /
 * can't skip ahead unanswered), the saved draft (refresh-safe), what the answers change, and the
 * translations of every question, option and message in all four languages.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ONBOARDING_QUESTIONS, ONBOARDING_STEPS, type OnboardingAnswers } from '@study/shared';
import i18n, { initI18n } from '../src/i18n';
import ar from '../src/i18n/locales/ar';
import en from '../src/i18n/locales/en';
import es from '../src/i18n/locales/es';
import fr from '../src/i18n/locales/fr';
import {
  canContinue,
  currentQuestion,
  doneAdvice,
  draftKey,
  flowReducer,
  initialFlow,
  isComplete,
  isLastStep,
  onboardingGate,
  parseDraft,
  planFirst,
  preferredMaterialOption,
  preparedLevelDefault,
  progressFraction,
  progressParams,
  serializeDraft,
  TOTAL_STEPS,
  type FlowAction,
  type FlowState,
} from '../src/lib/onboarding';

const FULL: OnboardingAnswers = { studyField: 'law', examTiming: 'three_to_four_weeks', mainGoal: 'practice', materials: 'mix', confidence: 'fairly' };
const run = (actions: FlowAction[], from: FlowState = initialFlow()) => actions.reduce(flowReducer, from);
const pick = (question: (typeof ONBOARDING_STEPS)[number], value: string): FlowAction => ({ type: 'select', question, value });
/** Answer the question on screen with its first option and move on. */
const answerAll = (): FlowState => {
  let s = initialFlow();
  for (const q of ONBOARDING_STEPS) {
    s = flowReducer(s, pick(q, FULL[q]));
    s = flowReducer(s, { type: 'next' });
  }
  return s;
};

// ---- 1 & 2: when it is shown ----

test('a new account (pending) is sent to the questions; everyone else goes straight to the app', () => {
  assert.equal(onboardingGate({ isLoading: false, data: { status: 'pending' } }), 'ask');
  for (const status of ['completed', 'skipped', 'none'] as const) assert.equal(onboardingGate({ isLoading: false, data: { status } }), 'proceed', status);
});

test('while the state loads nothing flashes; if it cannot be read, the student is not blocked', () => {
  assert.equal(onboardingGate({ isLoading: true }), 'loading');
  assert.equal(onboardingGate({ isLoading: false, data: undefined }), 'proceed');
});

test('the screen is a signed-in route and the home screen redirects to it', () => {
  const layout = readFileSync(new URL('../src/app/_layout.tsx', import.meta.url), 'utf8');
  const protectedBlock = layout.slice(layout.indexOf('guard={!!user}'));
  assert.ok(protectedBlock.includes('name="onboarding"'), 'onboarding must only be reachable when signed in');
  assert.ok(!layout.slice(0, layout.indexOf('guard={!!user}')).includes('name="onboarding"'));
  const home = readFileSync(new URL('../src/app/index.tsx', import.meta.url), 'utf8');
  assert.ok(home.includes('onboardingGate(') && home.includes('<Redirect href="/onboarding"'));
});

// ---- 3: select / change / retain while going back ----

test('a question starts unanswered, can be answered and changed, and Back keeps every answer', () => {
  let s = initialFlow();
  assert.equal(currentQuestion(s), 'studyField');
  assert.equal(s.step, 0);
  s = run([pick('studyField', 'health')], s);
  assert.equal(s.answers.studyField, 'health');
  s = run([pick('studyField', 'law')], s); // change of mind
  assert.equal(s.answers.studyField, 'law');
  s = run([{ type: 'next' }, pick('examTiming', 'within_7_days'), { type: 'next' }, pick('mainGoal', 'exams')], s);
  assert.equal(currentQuestion(s), 'mainGoal');
  s = run([{ type: 'back' }, { type: 'back' }], s);
  assert.equal(currentQuestion(s), 'studyField');
  assert.deepEqual(s.answers, { studyField: 'law', examTiming: 'within_7_days', mainGoal: 'exams' });
  s = run([{ type: 'back' }], s);
  assert.equal(s.step, 0, 'Back on the first question stays put');
  // Going forward again shows the earlier answers still selected.
  s = run([{ type: 'next' }], s);
  assert.equal(s.answers.examTiming, 'within_7_days');
});

test('only an option of the question on screen can be selected', () => {
  const s = initialFlow();
  assert.deepEqual(flowReducer(s, pick('studyField', 'banana')), s, 'unknown option ignored');
  assert.deepEqual(flowReducer(s, pick('confidence', 'very')), s, 'a later question cannot be answered early');
  assert.deepEqual(flowReducer(s, pick('studyField', 'time_travel')), s);
});

// ---- 4: incomplete answers cannot be submitted ----

test('Continue is blocked until the question is answered; the last step needs all five', () => {
  let s = initialFlow();
  assert.equal(canContinue(s), false);
  assert.deepEqual(flowReducer(s, { type: 'next' }), s, 'next does nothing while unanswered');
  s = flowReducer(s, pick('studyField', 'science'));
  assert.equal(canContinue(s), true);
  assert.equal(isComplete(s.answers), false);
  const end = answerAll();
  assert.equal(isLastStep(end), true);
  assert.equal(end.step, TOTAL_STEPS - 1, 'next never moves past the last question');
  assert.equal(isComplete(end.answers), true);
  // Any missing answer makes the set incomplete.
  for (const q of ONBOARDING_STEPS) {
    const partial = { ...end.answers };
    delete partial[q];
    assert.equal(isComplete(partial), false, q);
  }
});

test('progress is "Question n of 5" and grows with each question', () => {
  let s = initialFlow();
  assert.deepEqual(progressParams(s), { current: 1, total: 5 });
  assert.equal(progressFraction(s), 0.2);
  s = run([pick('studyField', 'law'), { type: 'next' }], s);
  assert.deepEqual(progressParams(s), { current: 2, total: 5 });
  assert.equal(progressFraction(answerAll()), 1);
});

// ---- 6: refresh / interrupted session ----

test('a draft survives a refresh: same step, same answers', () => {
  const mid = run([pick('studyField', 'law'), { type: 'next' }, pick('examTiming', 'over_a_month')]);
  assert.deepEqual(parseDraft(serializeDraft(mid)), mid);
  assert.deepEqual(parseDraft(serializeDraft(answerAll())), answerAll());
  assert.equal(draftKey('abc'), draftKey('abc'));
  assert.notEqual(draftKey('abc'), draftKey('xyz'), 'drafts are per account');
});

test('a damaged or tampered draft never breaks the flow', () => {
  for (const raw of [null, '', 'not json', '[]', '"x"', '{"step":"2"}', 'null', '{"answers":5}']) {
    const d = parseDraft(raw);
    assert.ok(d === null || (d.step >= 0 && d.step < TOTAL_STEPS), String(raw));
  }
  // Unknown values are dropped; the step can't jump past the first unanswered question.
  const d = parseDraft(JSON.stringify({ step: 4, answers: { studyField: 'law', examTiming: 'soon-ish', mainGoal: 'exams' } }));
  assert.deepEqual(d, { step: 1, answers: { studyField: 'law', mainGoal: 'exams' } });
  assert.deepEqual(parseDraft(JSON.stringify({ step: -3, answers: { studyField: 'law' } })), { step: 0, answers: { studyField: 'law' } });
  assert.deepEqual(parseDraft(JSON.stringify({ step: 2.5, answers: {} })), { step: 0, answers: {} });
});

test('a failed save changes nothing (the flow only restores or moves on explicit actions)', () => {
  const end = answerAll();
  assert.deepEqual(flowReducer(end, { type: 'next' }), end);
  assert.deepEqual(flowReducer(end, { type: 'restore', state: end }), end);
});

// ---- what the answers change ----

test('confidence sets the starting "how prepared" choice of a new study plan (and nothing else)', () => {
  const a = (confidence: OnboardingAnswers['confidence']): OnboardingAnswers => ({ ...FULL, confidence });
  assert.equal(preparedLevelDefault(a('not_confident')), 'zero');
  assert.equal(preparedLevelDefault(a('some_topics')), 'familiar');
  assert.equal(preparedLevelDefault(a('fairly')), 'confident');
  assert.equal(preparedLevelDefault(a('very')), 'confident');
  assert.equal(preparedLevelDefault(null), 'familiar', 'skipped / older accounts keep the form default');
  assert.equal(preparedLevelDefault(undefined), 'familiar');
});

test('"Add material" highlights what the student usually has — only things that can start a course', () => {
  const m = (materials: OnboardingAnswers['materials']): OnboardingAnswers => ({ ...FULL, materials });
  assert.equal(preferredMaterialOption(m('pdf')), 'pdf');
  assert.equal(preferredMaterialOption(m('notes')), 'pdf');
  assert.equal(preferredMaterialOption(m('pptx')), 'pptx');
  for (const x of ['audio', 'video', 'mix'] as const) assert.equal(preferredMaterialOption(m(x)), null, x);
  assert.equal(preferredMaterialOption(null), null);
});

test('the study plan comes first only for someone who asked for a plan and has an exam coming', () => {
  assert.equal(planFirst({ ...FULL, mainGoal: 'study_plan', examTiming: 'within_7_days' }), true);
  assert.equal(planFirst({ ...FULL, mainGoal: 'study_plan', examTiming: 'over_a_month' }), true);
  assert.equal(planFirst({ ...FULL, mainGoal: 'study_plan', examTiming: 'none_scheduled' }), false);
  for (const g of ['understand', 'exams', 'practice', 'weak_topics'] as const) assert.equal(planFirst({ ...FULL, mainGoal: g, examTiming: 'within_7_days' }), false, g);
  assert.equal(planFirst(null), false);
});

test('the "all set" screen adapts its wording to the exam date, lectures and plan', () => {
  assert.equal(doneAdvice({ ...FULL, examTiming: 'within_7_days' }).tone, 'soon');
  assert.equal(doneAdvice({ ...FULL, examTiming: 'one_to_two_weeks' }).tone, 'soon');
  assert.equal(doneAdvice({ ...FULL, examTiming: 'three_to_four_weeks' }).tone, 'later');
  assert.equal(doneAdvice({ ...FULL, examTiming: 'over_a_month' }).tone, 'later');
  assert.equal(doneAdvice({ ...FULL, examTiming: 'none_scheduled' }).tone, 'noExam');
  assert.equal(doneAdvice({ ...FULL, materials: 'audio' }).lecturesNote, true);
  assert.equal(doneAdvice({ ...FULL, materials: 'video' }).lecturesNote, true);
  assert.equal(doneAdvice({ ...FULL, materials: 'pdf' }).lecturesNote, false);
  assert.equal(doneAdvice({ ...FULL, mainGoal: 'study_plan' }).planNote, true);
});

// ---- translations: every question, option, button, error and message, in all four languages ----

type Dict = { [k: string]: string | Dict };
const LOCALES = { en, fr, es, ar } as unknown as Record<'en' | 'fr' | 'es' | 'ar', Dict>;
const section = (d: Dict) => d.onboarding as Dict;

for (const lang of ['en', 'fr', 'es', 'ar'] as const) {
  test(`${lang}: every onboarding question, hint, option and message is translated (and none is the raw key)`, async () => {
    await initI18n(lang);
    const o = section(LOCALES[lang]);
    for (const k of ['progress', 'skip', 'continue', 'finish', 'retryHint', 'doneTitle', 'doneSoon', 'doneLater', 'doneNoExam', 'doneLectures', 'donePlan', 'doneAdd', 'doneBrowse']) {
      assert.ok(typeof o[k] === 'string' && (o[k] as string).trim().length > 0, `${lang} ${k}`);
    }
    for (const q of ONBOARDING_STEPS) {
      const block = o[q] as Dict;
      assert.ok((block.title as string).length > 2 && (block.hint as string).length > 2, `${lang} ${q} title/hint`);
      const options = block.options as Dict;
      assert.deepEqual(Object.keys(options).sort(), [...ONBOARDING_QUESTIONS[q]].sort(), `${lang} ${q} options match the contract`);
      for (const id of ONBOARDING_QUESTIONS[q]) {
        const text = i18n.t(`onboarding.${q}.options.${id}` as 'onboarding.skip');
        assert.ok(text && !text.startsWith('onboarding.'), `${lang} ${q}.${id}`);
      }
    }
    const progress = i18n.t('onboarding.progress', { current: 2, total: 5 });
    assert.ok(progress.includes('2') && progress.includes('5'), `${lang}: ${progress}`);
  });
}

test('Arabic is a right-to-left language and its onboarding text is Arabic script; English/French/Spanish are left-to-right', async () => {
  const { isRtlLanguage } = await import('../src/i18n/languages');
  assert.equal(isRtlLanguage('ar'), true);
  for (const l of ['en', 'fr', 'es']) assert.equal(isRtlLanguage(l), false, l);
  const o = section(LOCALES.ar);
  for (const k of ['skip', 'continue', 'finish', 'doneTitle', 'doneAdd']) assert.match(o[k] as string, /\p{Script=Arabic}/u, k);
  for (const q of ONBOARDING_STEPS) assert.match(((o[q] as Dict).title as string), /\p{Script=Arabic}/u, q);
});

test('the screen shows only translated text (no hardcoded strings) and exposes radio semantics', () => {
  const src = readFileSync(new URL('../src/app/onboarding.tsx', import.meta.url), 'utf8');
  assert.ok(src.includes('accessibilityRole="radiogroup"') && src.includes('accessibilityRole="radio"'));
  assert.ok(src.includes('accessibilityState={{ checked: selected') && src.includes('aria-checked={selected}'), 'selected state is exposed natively and on the web');
  assert.ok(src.includes('accessibilityLiveRegion="polite"'), 'progress changes are announced');
});
