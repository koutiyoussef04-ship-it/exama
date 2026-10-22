-- No automatic pilot for new organizations. A new organization starts with NO plan ('none'): no uploads and no AI
-- drafts until the B2B owner assigns a paid plan or grants an individually negotiated pilot.
-- 1. organizations_plan_check (migration 0023) allowed only pilot/esencial/profesional/centro: 'none' is added.
-- 2. The column default 'pilot' would hand a pilot to any insert that omits the plan: it becomes 'none'.
-- NO ROW IS CHANGED: existing organizations keep their plan, and running pilots keep their end dates.
-- Rollback (only while no organization has plan = 'none'):
--   ALTER TABLE organizations DROP CONSTRAINT organizations_plan_check;
--   ALTER TABLE organizations ALTER COLUMN plan SET DEFAULT 'pilot';
--   ALTER TABLE organizations ADD CONSTRAINT organizations_plan_check CHECK (plan in ('pilot', 'esencial', 'profesional', 'centro'));
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_plan_check";--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'none';--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_check" CHECK ("organizations"."plan" in ('none', 'pilot', 'esencial', 'profesional', 'centro'));
