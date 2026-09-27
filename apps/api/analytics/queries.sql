-- Exama — product analytics queries over the analytics_events table.
-- Used by `npm run analytics:report`. To run one by hand (pgAdmin / psql), replace $1 with a
-- number of days, e.g. 30. All times are UTC.

-- name: funnel
-- Users who signed up in the window, and how far each got (ever, not only within the window).
WITH cohort AS (
  SELECT user_id FROM analytics_events
  WHERE name = 'signup_completed' AND user_id IS NOT NULL AND created_at >= now() - make_interval(days => $1)
  GROUP BY user_id
), reached AS (
  SELECT c.user_id,
    bool_or(e.name = 'upload_succeeded')                                                        AS uploaded,
    bool_or(e.name = 'document_processing_completed' AND (e.properties->>'success')::boolean)   AS processed,
    bool_or(e.name = 'exam_started')                                                            AS exam_started,
    bool_or(e.name = 'exam_completed')                                                          AS exam_completed,
    bool_or(e.name = 'practice_started')                                                        AS practice_started,
    bool_or(e.name = 'practice_completed')                                                      AS practice_completed
  FROM cohort c LEFT JOIN analytics_events e ON e.user_id = c.user_id
  GROUP BY c.user_id
)
SELECT
  count(*)::int                                          AS signed_up,
  count(*) FILTER (WHERE uploaded)::int                  AS uploaded_pdf,
  count(*) FILTER (WHERE processed)::int                 AS course_processed,
  count(*) FILTER (WHERE exam_started)::int              AS exam_started,
  count(*) FILTER (WHERE exam_completed)::int            AS exam_completed,
  count(*) FILTER (WHERE practice_started)::int          AS practice_started,
  count(*) FILTER (WHERE practice_completed)::int        AS practice_completed
FROM reached;

-- name: documents
-- Upload → processing success, per document (retries count once).
SELECT
  count(DISTINCT properties->>'document_id') FILTER (WHERE name = 'upload_succeeded')::int AS uploads,
  count(DISTINCT properties->>'document_id') FILTER (WHERE name = 'document_processing_completed' AND (properties->>'success')::boolean)::int AS processed_ok,
  count(*) FILTER (WHERE name = 'upload_failed')::int AS upload_failures,
  count(*) FILTER (WHERE name = 'document_processing_completed' AND NOT (properties->>'success')::boolean)::int AS processing_failures,
  round(avg((properties->>'duration_ms')::numeric / 1000) FILTER (WHERE name = 'document_processing_completed' AND (properties->>'success')::boolean), 1) AS avg_processing_s,
  round(avg((properties->>'page_count')::numeric) FILTER (WHERE name = 'document_processing_completed' AND (properties->>'success')::boolean), 1) AS avg_pages
FROM analytics_events
WHERE created_at >= now() - make_interval(days => $1);

-- name: exams
-- Generation reliability/latency and completion scores, by kind.
SELECT
  CASE WHEN properties->>'kind' = 'follow_up' THEN 'practice' ELSE 'exam' END AS kind,
  count(*) FILTER (WHERE (properties->>'success')::boolean)::int     AS generated,
  count(*) FILTER (WHERE NOT (properties->>'success')::boolean)::int AS generation_failed,
  round(avg((properties->>'duration_ms')::numeric / 1000) FILTER (WHERE (properties->>'success')::boolean), 1) AS avg_generation_s
FROM analytics_events
WHERE name = 'exam_generation_completed' AND created_at >= now() - make_interval(days => $1)
GROUP BY 1 ORDER BY 1;

-- name: completions
SELECT
  CASE WHEN name = 'practice_completed' THEN 'practice' ELSE 'exam' END AS kind,
  count(*)::int AS completed,
  round(avg((properties->>'score_pct')::numeric)) AS avg_score_pct,
  round(avg((properties->>'weak_topic_count')::numeric), 1) AS avg_weak_topics_after,
  round(avg(((properties->>'answered_count')::numeric / nullif((properties->>'question_count')::numeric, 0)) * 100)) AS avg_answered_pct
FROM analytics_events
WHERE name IN ('exam_completed', 'practice_completed') AND created_at >= now() - make_interval(days => $1)
GROUP BY 1 ORDER BY 1;

-- name: failures
-- Top failure reasons (categories only).
SELECT name, coalesce(properties->>'failure_reason', 'unknown') AS reason, count(*)::int AS count
FROM analytics_events
WHERE created_at >= now() - make_interval(days => $1)
  AND (name = 'upload_failed'
       OR (name IN ('document_processing_completed', 'exam_generation_completed') AND NOT (properties->>'success')::boolean))
GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10;

-- name: retention
-- Activity = any event linked to a user. Day-1: came back 24–48h after signup.
-- Week-1: came back between 24h and 8 days after signup (only signups old enough are counted).
WITH active AS (
  SELECT DISTINCT user_id, date_trunc('day', created_at) AS day
  FROM analytics_events WHERE user_id IS NOT NULL AND created_at >= now() - make_interval(days => $1)
), per_user AS (
  SELECT user_id, count(*) AS days FROM active GROUP BY user_id
), signups AS (
  SELECT user_id, min(created_at) AS at FROM analytics_events
  WHERE name = 'signup_completed' AND user_id IS NOT NULL AND created_at >= now() - make_interval(days => $1)
  GROUP BY user_id
), returns AS (
  SELECT s.user_id, s.at,
    EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.created_at >= s.at + interval '1 day' AND e.created_at < s.at + interval '2 days') AS d1,
    EXISTS (SELECT 1 FROM analytics_events e WHERE e.user_id = s.user_id AND e.created_at >= s.at + interval '1 day' AND e.created_at < s.at + interval '8 days') AS w1
  FROM signups s
)
SELECT
  (SELECT count(*) FROM per_user)::int                                                        AS active_users,
  (SELECT count(DISTINCT user_id) FROM active WHERE day = date_trunc('day', now()))::int      AS active_today,
  (SELECT count(DISTINCT user_id) FROM active WHERE day >= date_trunc('day', now()) - interval '6 days')::int AS active_last_7d,
  (SELECT count(*) FROM per_user WHERE days >= 2)::int                                        AS returning_users,
  (SELECT round(avg(days), 1) FROM per_user)                                                  AS avg_active_days,
  (SELECT count(*) FROM returns WHERE at <= now() - interval '2 days')::int                   AS d1_eligible,
  (SELECT count(*) FROM returns WHERE at <= now() - interval '2 days' AND d1)::int            AS d1_returned,
  (SELECT count(*) FROM returns WHERE at <= now() - interval '8 days')::int                   AS w1_eligible,
  (SELECT count(*) FROM returns WHERE at <= now() - interval '8 days' AND w1)::int            AS w1_returned,
  (SELECT count(*) FROM analytics_events WHERE name = 'app_opened' AND created_at >= now() - make_interval(days => $1))::int AS app_opens;

-- name: monetization
-- Paywall → upgrade → trial/subscription. Real store purchases only (environment = production)
-- unless $2 = true, which also counts mock (test) and App Store / Google Play sandbox purchases.
SELECT
  count(DISTINCT coalesce(user_id::text, anonymous_id)) FILTER (WHERE name = 'paywall_viewed')::int AS paywall_viewers,
  count(DISTINCT coalesce(user_id::text, anonymous_id)) FILTER (WHERE name = 'upgrade_started')::int AS upgrade_starters,
  count(DISTINCT user_id) FILTER (WHERE name = 'trial_started' AND (coalesce(properties->>'environment', CASE WHEN properties->>'provider' = 'mock' THEN 'test' ELSE 'production' END) = 'production' OR $2))::int AS trials,
  count(DISTINCT user_id) FILTER (WHERE name = 'subscription_started' AND (coalesce(properties->>'environment', CASE WHEN properties->>'provider' = 'mock' THEN 'test' ELSE 'production' END) = 'production' OR $2))::int AS subscribers,
  count(*) FILTER (WHERE name = 'subscription_started' AND (properties->>'from_trial')::boolean AND (coalesce(properties->>'environment', CASE WHEN properties->>'provider' = 'mock' THEN 'test' ELSE 'production' END) = 'production' OR $2))::int AS trial_conversions,
  count(*) FILTER (WHERE name = 'subscription_cancelled' AND (coalesce(properties->>'environment', CASE WHEN properties->>'provider' = 'mock' THEN 'test' ELSE 'production' END) = 'production' OR $2))::int AS cancellations,
  count(*) FILTER (WHERE name = 'subscription_expired' AND (coalesce(properties->>'environment', CASE WHEN properties->>'provider' = 'mock' THEN 'test' ELSE 'production' END) = 'production' OR $2))::int AS expirations,
  count(*) FILTER (WHERE name = 'subscription_restored' AND (coalesce(properties->>'environment', CASE WHEN properties->>'provider' = 'mock' THEN 'test' ELSE 'production' END) = 'production' OR $2))::int AS restores
FROM analytics_events
WHERE created_at >= now() - make_interval(days => $1);

-- name: free_lecture
-- The Free plan's single lecture: how many accounts used it, how many then saw the paywall
-- because it was used up, and how many of them subscribed afterwards (any tier).
WITH used AS (
  SELECT user_id, min(created_at) AS at
  FROM analytics_events
  WHERE name = 'material_processing_started' AND properties->>'lecture_allowance' = 'once'
    AND created_at >= now() - make_interval(days => $1)
  GROUP BY user_id
)
SELECT
  (SELECT count(*) FROM used)::int AS free_lectures,
  (SELECT count(DISTINCT e.user_id) FROM analytics_events e JOIN used u ON u.user_id = e.user_id
     WHERE e.name = 'paywall_viewed' AND e.properties->>'trigger' = 'free_lecture_used' AND e.created_at >= u.at)::int AS saw_paywall,
  (SELECT count(DISTINCT e.user_id) FROM analytics_events e JOIN used u ON u.user_id = e.user_id
     WHERE e.name IN ('trial_started', 'subscription_started') AND e.created_at >= u.at)::int AS converted;

-- name: plans_by_tier
-- The same monetization funnel split by paid tier (Basic / Student / Pro). Plan choices on the
-- paywall come from the app; trials, subscriptions, upgrades and downgrades from the server.
-- $2 = true also counts mock (test) and store sandbox purchases.
WITH e AS (
  SELECT name, user_id, anonymous_id, properties,
         coalesce(properties->>'tier', split_part(properties->>'plan_id', '_', 1)) AS tier,
         (coalesce(properties->>'environment', CASE WHEN properties->>'provider' = 'mock' THEN 'test' ELSE 'production' END) = 'production' OR $2) AS counted
  FROM analytics_events
  WHERE created_at >= now() - make_interval(days => $1)
    AND name IN ('plan_selected', 'upgrade_started', 'trial_started', 'subscription_started', 'subscription_cancelled', 'subscription_expired')
)
SELECT
  tier,
  count(*) FILTER (WHERE name = 'plan_selected')::int AS selected,
  count(DISTINCT coalesce(user_id::text, anonymous_id)) FILTER (WHERE name = 'upgrade_started')::int AS upgrade_starters,
  count(DISTINCT user_id) FILTER (WHERE name = 'trial_started' AND counted)::int AS trials,
  count(DISTINCT user_id) FILTER (WHERE name = 'subscription_started' AND counted)::int AS subscribers,
  count(*) FILTER (WHERE name = 'subscription_started' AND counted AND properties->>'change' = 'upgrade')::int AS upgrades_into,
  count(*) FILTER (WHERE name = 'subscription_started' AND counted AND properties->>'change' = 'downgrade')::int AS downgrades_into,
  count(*) FILTER (WHERE name = 'subscription_started' AND counted AND properties->>'period' = 'yearly')::int AS yearly,
  count(*) FILTER (WHERE name = 'subscription_cancelled' AND counted)::int AS cancellations,
  count(*) FILTER (WHERE name = 'subscription_expired' AND counted)::int AS expirations
FROM e
WHERE tier IN ('basic', 'student', 'pro')
GROUP BY tier
ORDER BY array_position(ARRAY['basic', 'student', 'pro'], tier);
