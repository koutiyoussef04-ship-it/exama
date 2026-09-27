CREATE TYPE "public"."material_kind" AS ENUM('pdf', 'audio', 'video');--> statement-breakpoint
CREATE TYPE "public"."material_status" AS ENUM('processing', 'transcribing', 'analyzing', 'ready', 'failed');--> statement-breakpoint
ALTER TYPE "public"."usage_kind" ADD VALUE 'media_upload';--> statement-breakpoint
ALTER TYPE "public"."usage_kind" ADD VALUE 'media_minutes';--> statement-breakpoint
CREATE TABLE "course_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "material_kind" NOT NULL,
	"format" text NOT NULL,
	"title" text NOT NULL,
	"status" "material_status" DEFAULT 'processing' NOT NULL,
	"error_code" text,
	"failed_stage" text,
	"attempts" integer DEFAULT 1 NOT NULL,
	"file_key" text,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_seconds" integer,
	"page_count" integer,
	"billed_minutes" integer DEFAULT 0 NOT NULL,
	"minutes_ledger_id" uuid,
	"transcription_provider" text,
	"ai_language" text DEFAULT 'en' NOT NULL,
	"language" text,
	"source_language" text,
	"summary" text,
	"knowledge" jsonb,
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"new_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"media_deleted_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "material_id" uuid;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "start_s" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "end_s" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "base_topics" jsonb;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_materials_document_idx" ON "course_materials" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "course_materials_user_status_idx" ON "course_materials" USING btree ("user_id","status");--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_material_id_course_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."course_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chunks_material_idx" ON "document_chunks" USING btree ("material_id");--> statement-breakpoint
-- Existing courses: every current topic came from the original PDF.
UPDATE "documents" SET "base_topics" = "topics" WHERE "base_topics" IS NULL;
