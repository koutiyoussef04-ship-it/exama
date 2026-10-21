-- Organization categories for French-speaking markets and the Gulf: university, school, training_center, corporate,
-- exam_prep, other. The two values of the organizations created before (training_provider, academy) stay allowed, so
-- NO ROW IS CHANGED: this only widens the CHECK constraint from migration 0022, which would otherwise reject the new values.
-- Rollback (only while no organization holds one of the six new values):
--   ALTER TABLE organizations DROP CONSTRAINT organizations_market_check;
--   ALTER TABLE organizations ADD CONSTRAINT organizations_market_check CHECK (market in ('training_provider', 'academy'));
ALTER TABLE "organizations" DROP CONSTRAINT "organizations_market_check";--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_market_check" CHECK ("organizations"."market" in ('university', 'school', 'training_center', 'corporate', 'exam_prep', 'other', 'training_provider', 'academy'));
