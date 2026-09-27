-- Three-tier catalog (Basic / Student / Pro, monthly or yearly): yearly plan ids end in "_yearly".
-- Existing yearly subscriptions keep their tier; only the id changes. Analytics history is left as recorded.
UPDATE "subscriptions" SET "plan_id" = 'student_yearly' WHERE "plan_id" = 'student_annual';--> statement-breakpoint
UPDATE "subscriptions" SET "plan_id" = 'pro_yearly' WHERE "plan_id" = 'pro_annual';
