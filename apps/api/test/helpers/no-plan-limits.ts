/**
 * Core-loop tests exercise product behavior, not billing: lift the free-plan caps and give the free
 * plan every feature for them (adaptive practice/planner, weak-topic analysis, lectures).
 * Plan limits and features have their own tests in billing.test.ts / plans.test.ts. Import before the app.
 */
process.env.PLAN_LIMITS_OVERRIDE = JSON.stringify({
  free: { courses: null, courseUploadsPerMonth: null, examGenerationsPerMonth: null, practiceQuestionsPerMonth: null },
});
process.env.PLAN_FEATURES_OVERRIDE = JSON.stringify({
  free: { lectures: true, adaptivePractice: true, weakTopicAnalysis: true, adaptivePlanner: true },
});
export {};
