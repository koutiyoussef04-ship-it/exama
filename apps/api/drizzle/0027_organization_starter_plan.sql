-- Starter plan for organizations (independent trainers and small organizations): 'starter' joins the plans the
-- organizations_plan_check constraint accepts. NO ROW IS CHANGED and the column default stays 'none'. Allowances and
-- prices live in the code (packages/shared/src/organizations.ts, ORGANIZATION_PLAN_CATALOG), not in the database.
-- Rollback (only while no organization has plan = 'starter'):
--   ALTER TABLE organizations DROP CONSTRAINT organizations_plan_check;
--   ALTER TABLE organizations ADD CONSTRAINT organizations_plan_check CHECK (plan in ('none', 'pilot', 'esencial', 'profesional', 'centro'));
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_plan_check";--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_check" CHECK ("organizations"."plan" in ('none', 'pilot', 'starter', 'esencial', 'profesional', 'centro'));