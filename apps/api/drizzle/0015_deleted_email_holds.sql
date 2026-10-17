CREATE TABLE "deleted_email_holds" (
	"email_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "deleted_email_holds_expires_idx" ON "deleted_email_holds" USING btree ("expires_at");