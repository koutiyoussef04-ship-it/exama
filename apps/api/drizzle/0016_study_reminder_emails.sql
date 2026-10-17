CREATE TABLE "study_reminder_emails" (
	"user_id" uuid NOT NULL,
	"local_date" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_reminder_emails_user_id_local_date_pk" PRIMARY KEY("user_id","local_date")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "study_reminder_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "study_reminder_emails" ADD CONSTRAINT "study_reminder_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "study_reminder_emails_updated_idx" ON "study_reminder_emails" USING btree ("updated_at");