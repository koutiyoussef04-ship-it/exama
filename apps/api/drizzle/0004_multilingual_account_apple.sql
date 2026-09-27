ALTER TABLE "documents" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ai_language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "summary_language" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "source_language" text;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "language" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "environment" text DEFAULT 'test' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_ref_uq" ON "subscriptions" USING btree ("provider","provider_ref") WHERE "subscriptions"."provider_ref" is not null;