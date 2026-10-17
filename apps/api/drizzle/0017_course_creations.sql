CREATE TABLE "course_creations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_creations" ADD CONSTRAINT "course_creations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_creations_user_idx" ON "course_creations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_creations_document_uq" ON "course_creations" USING btree ("document_id");--> statement-breakpoint
-- Backfill: every course that exists today counts as created (its own creation time). Courses deleted
-- before this migration left no record and are not counted (never over-counts an existing account).
INSERT INTO "course_creations" ("user_id", "document_id", "created_at")
SELECT "user_id", "id", "created_at" FROM "documents"
ON CONFLICT ("document_id") DO NOTHING;
