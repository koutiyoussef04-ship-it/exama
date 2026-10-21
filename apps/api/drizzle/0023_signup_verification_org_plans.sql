CREATE TABLE "pending_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"account_type" text NOT NULL,
	"age_range" text,
	"organization_name" text,
	"market" text,
	"marketing_consent" jsonb,
	"language" text DEFAULT 'en' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pending_signups_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan" text DEFAULT 'pilot' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_period" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pilot_started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pilot_ends_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "pending_signups_email_idx" ON "pending_signups" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "pending_signups_expires_idx" ON "pending_signups" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_check" CHECK ("organizations"."plan" in ('pilot', 'esencial', 'profesional', 'centro'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_billing_period_check" CHECK ("organizations"."billing_period" is null or "organizations"."billing_period" in ('monthly', 'yearly'));--> statement-breakpoint
-- Organizations that existed before plans start their 30-day pilot now (pilot_started_at defaults to now(); they had no end date).
UPDATE "organizations" SET "pilot_ends_at" = "pilot_started_at" + interval '30 days' WHERE "plan" = 'pilot' AND "pilot_ends_at" IS NULL;
