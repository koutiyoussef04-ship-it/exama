CREATE TABLE "flashcard_decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"language" text NOT NULL,
	"round" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flashcards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deck_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"topic" text NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"source_quote" text NOT NULL,
	"in_round" boolean DEFAULT true NOT NULL,
	"round_result" text,
	"last_result" text,
	"known_count" integer DEFAULT 0 NOT NULL,
	"practice_count" integer DEFAULT 0 NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "flashcards_round_result_check" CHECK ("flashcards"."round_result" is null or "flashcards"."round_result" in ('known', 'practice')),
	CONSTRAINT "flashcards_last_result_check" CHECK ("flashcards"."last_result" is null or "flashcards"."last_result" in ('known', 'practice'))
);
--> statement-breakpoint
ALTER TABLE "flashcard_decks" ADD CONSTRAINT "flashcard_decks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_decks" ADD CONSTRAINT "flashcard_decks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_deck_id_flashcard_decks_id_fk" FOREIGN KEY ("deck_id") REFERENCES "public"."flashcard_decks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flashcard_decks_user_document_idx" ON "flashcard_decks" USING btree ("user_id","document_id");--> statement-breakpoint
CREATE INDEX "flashcards_deck_idx" ON "flashcards" USING btree ("deck_id");