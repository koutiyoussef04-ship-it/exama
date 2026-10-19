-- Read-only: how many accounts the reactivation campaign would email, by audience, and why the others are left out.
-- Run it with psql against the database (Render: exama-db → Connect → External Connection, from an allow-listed IP,
-- or from the exama-api Shell). It changes nothing. Same first-matching-rule order as the campaign code
-- (apps/api/src/services/reactivation-campaign.ts), with two differences: owner accounts (OWNER_USER_IDS /
-- OWNER_EMAILS, set in the environment) cannot be seen from SQL, and former subscribers are counted as one group.
with u as (
  select u.id, u.created_at, u.age_range,
    u.study_reminder_emails as reminders_on,
    (u.email_verified_at is not null) as verified,
    exists (select 1 from email_suppressions s where s.email = lower(u.email)) as suppressed,
    exists (select 1 from subscriptions s where s.user_id = u.id) as has_sub,
    exists (select 1 from stripe_customers c where c.user_id = u.id) as has_customer,
    exists (select 1 from study_plans p where p.user_id = u.id) as has_plan,
    exists (select 1 from documents d where d.user_id = u.id and d.status = 'ready') as has_course,
    (select max(e.created_at) from analytics_events e where e.user_id = u.id and e.name = 'app_opened' and e.source = 'client') as last_open,
    (select max(r.updated_at) from study_reminder_emails r where r.user_id = u.id and r.status = 'sent') as last_reminder,
    exists (select 1 from email_campaign_sends c where c.user_id = u.id and c.campaign = 'reactivation-2026-10' and c.step = 1) as already_sent
  from users u
), r as (
  select *,
    case
      when not verified then '01 email not confirmed'
      when not reminders_on then '02 study emails switched off / unsubscribed'
      when suppressed then '03 on the suppression list'
      when age_range is null or age_range not in ('18_24', '25_34', '35_plus') then '04 under 18 or no age group'
      when already_sent then '05 already got step 1'
      when created_at > now() - interval '3 days' then '06 account younger than 3 days'
      when greatest(created_at, coalesce(last_open, created_at)) > now() - interval '7 days' then '07 opened the app in the last 7 days'
      when last_reminder > now() - interval '7 days' then '08 got a daily reminder in the last 7 days'
      when has_sub then '09 has or had a subscription (current ones are never emailed; former ones are held out)'
      when has_customer then '10 started a web checkout'
      else 'ELIGIBLE'
    end as reason
  from u
)
select reason,
  case when reason <> 'ELIGIBLE' then null when has_plan then '1 has a study plan' else '2 no study plan' end as segment,
  case when reason <> 'ELIGIBLE' then null when has_plan then null when has_course then 'course, no plan' else 'no course' end as detail,
  count(*) as accounts
from r
group by 1, 2, 3
order by (reason = 'ELIGIBLE'), reason, segment, detail;
