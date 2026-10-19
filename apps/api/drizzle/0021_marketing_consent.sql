CREATE TABLE "marketing_consent_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"version" text,
	"language" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_consent_log_action_check" CHECK ("marketing_consent_log"."action" in ('granted', 'withdrawn')),
	CONSTRAINT "marketing_consent_log_source_check" CHECK ("marketing_consent_log"."source" in ('signup', 'account', 'unsubscribe_link'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_consent_version" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_consent_language" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "marketing_consent_source" text;--> statement-breakpoint
ALTER TABLE "marketing_consent_log" ADD CONSTRAINT "marketing_consent_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_consent_log_user_idx" ON "marketing_consent_log" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_marketing_consent_check" CHECK (("users"."marketing_consent_at" is null and "users"."marketing_consent_version" is null and "users"."marketing_consent_language" is null and "users"."marketing_consent_source" is null)
      or ("users"."marketing_consent_at" is not null and "users"."marketing_consent_version" is not null and "users"."marketing_consent_language" in ('en', 'es', 'fr', 'ar') and "users"."marketing_consent_source" in ('signup', 'account')));