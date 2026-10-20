ALTER TYPE "public"."usage_kind" ADD VALUE 'bank_items';--> statement-breakpoint
CREATE TABLE "bank_item_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bank_item_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"version" integer NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_item_revisions" (
	"bank_item_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_item_revisions_bank_item_id_version_pk" PRIMARY KEY("bank_item_id","version")
);
--> statement-breakpoint
CREATE TABLE "bank_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"type" "question_type" NOT NULL,
	"topic" text NOT NULL,
	"section" text,
	"stem" text NOT NULL,
	"options" jsonb,
	"correct_answer" text NOT NULL,
	"explanation" text DEFAULT '' NOT NULL,
	"difficulty" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"origin" text NOT NULL,
	"review_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification" jsonb,
	"legal_ref" jsonb,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_items_status_check" CHECK ("bank_items"."status" in ('draft', 'approved', 'rejected', 'retired')),
	CONSTRAINT "bank_items_origin_check" CHECK ("bank_items"."origin" in ('ai', 'manual')),
	CONSTRAINT "bank_items_difficulty_check" CHECK ("bank_items"."difficulty" is null or "bank_items"."difficulty" in ('easy', 'medium', 'hard'))
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "organization_members_role_check" CHECK ("organization_members"."role" in ('admin', 'editor', 'reviewer'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"market" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_market_check" CHECK ("organizations"."market" in ('training_provider', 'academy'))
);
--> statement-breakpoint
CREATE TABLE "question_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"bank_item_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"material_id" uuid,
	"chunk_id" uuid,
	"chunk_hash" text NOT NULL,
	"page_start" integer,
	"page_end" integer,
	"start_s" integer,
	"end_s" integer,
	"quote" text NOT NULL,
	"quote_start" integer,
	"quote_end" integer,
	"match_score" real NOT NULL,
	"located" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_materials" DROP CONSTRAINT "course_materials_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "usage_ledger" DROP CONSTRAINT "usage_ledger_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "course_materials" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_ledger" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_type" text DEFAULT 'student' NOT NULL;--> statement-breakpoint
-- Unique indexes first: the composite foreign keys below reference them.
CREATE UNIQUE INDEX "documents_id_organization_uq" ON "documents" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_items_id_organization_uq" ON "bank_items" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "bank_item_events" ADD CONSTRAINT "bank_item_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_item_events" ADD CONSTRAINT "bank_item_events_bank_item_id_bank_items_id_fk" FOREIGN KEY ("bank_item_id") REFERENCES "public"."bank_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_item_events" ADD CONSTRAINT "bank_item_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_item_revisions" ADD CONSTRAINT "bank_item_revisions_bank_item_id_bank_items_id_fk" FOREIGN KEY ("bank_item_id") REFERENCES "public"."bank_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_item_revisions" ADD CONSTRAINT "bank_item_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_items" ADD CONSTRAINT "bank_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_items" ADD CONSTRAINT "bank_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_items" ADD CONSTRAINT "bank_items_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_items" ADD CONSTRAINT "bank_items_document_fk" FOREIGN KEY ("document_id","organization_id") REFERENCES "public"."documents"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_sources" ADD CONSTRAINT "question_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_sources" ADD CONSTRAINT "question_sources_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_sources" ADD CONSTRAINT "question_sources_material_id_course_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."course_materials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_sources" ADD CONSTRAINT "question_sources_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_sources" ADD CONSTRAINT "question_sources_item_fk" FOREIGN KEY ("bank_item_id","organization_id") REFERENCES "public"."bank_items"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_item_events_org_time_idx" ON "bank_item_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "bank_item_events_item_idx" ON "bank_item_events" USING btree ("bank_item_id");--> statement-breakpoint
CREATE INDEX "bank_items_org_doc_status_idx" ON "bank_items" USING btree ("organization_id","document_id","status");--> statement-breakpoint
CREATE INDEX "bank_items_org_topic_idx" ON "bank_items" USING btree ("organization_id","topic");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "question_sources_item_idx" ON "question_sources" USING btree ("bank_item_id");--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_organization_time_idx" ON "ai_usage" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_organization_idx" ON "documents" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_organization_kind_time_idx" ON "usage_ledger" USING btree ("organization_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_check" CHECK ("documents"."organization_id" is not null or "documents"."user_id" is not null);--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_owner_check" CHECK ("usage_ledger"."user_id" is not null or "usage_ledger"."organization_id" is not null);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_type_check" CHECK ("users"."account_type" in ('student', 'organization'));