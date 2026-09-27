CREATE TYPE "public"."study_plan_phase" AS ENUM('learn', 'practice', 'test', 'review', 'final');--> statement-breakpoint
CREATE TYPE "public"."prepared_level" AS ENUM('zero', 'familiar', 'confident');--> statement-breakpoint
CREATE TYPE "public"."study_task_activity" AS ENUM('learn', 'review', 'practice', 'exam', 'weak_review');--> statement-breakpoint
CREATE TYPE "public"."study_task_status" AS ENUM('pending', 'completed', 'skipped', 'missed');--> statement-breakpoint
ALTER TYPE "public"."usage_kind" ADD VALUE 'study_plan_generation';--> statement-breakpoint
CREATE TABLE "study_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"exam_date" text NOT NULL,
	"exam_time" text,
	"minutes_per_day" integer NOT NULL,
	"prepared_level" "prepared_level" NOT NULL,
	"study_days" jsonb NOT NULL,
	"unavailable_dates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"topic_insights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"daily_minutes" integer NOT NULL,
	"uncovered_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"planned_for" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"date" text NOT NULL,
	"position" integer NOT NULL,
	"topic" text,
	"activity" "study_task_activity" NOT NULL,
	"phase" "study_plan_phase" NOT NULL,
	"minutes" integer NOT NULL,
	"reason" text NOT NULL,
	"mastery" real,
	"question_count" integer,
	"status" "study_task_status" DEFAULT 'pending' NOT NULL,
	"exam_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_tasks" ADD CONSTRAINT "study_tasks_plan_id_study_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_tasks" ADD CONSTRAINT "study_tasks_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "study_plans_document_uq" ON "study_plans" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "study_plans_user_idx" ON "study_plans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "study_tasks_plan_date_idx" ON "study_tasks" USING btree ("plan_id","date","position");--> statement-breakpoint
CREATE INDEX "study_tasks_exam_idx" ON "study_tasks" USING btree ("exam_id");