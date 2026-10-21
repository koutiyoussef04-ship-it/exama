-- Separate student and organization identities: one account per (email, account_type) instead of one per email.
-- Additive for existing data (every current email is unique, so the new index builds without conflicts).
-- The new unique index is created BEFORE the old constraint is dropped, so uniqueness is enforced throughout.
-- Rollback (only while no email has both a student and an organization account):
--   ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);
--   DROP INDEX users_email_account_type_unique; ALTER TABLE users DROP CONSTRAINT users_b2b_role_check; ALTER TABLE users DROP COLUMN b2b_role;
CREATE UNIQUE INDEX "users_email_account_type_unique" ON "users" USING btree ("email","account_type");--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "b2b_role" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_b2b_role_check" CHECK ("users"."b2b_role" is null or ("users"."b2b_role" = 'owner' and "users"."account_type" = 'organization'));
