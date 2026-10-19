CREATE TABLE "email_campaign_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"send_id" uuid NOT NULL,
	"suspected_bot" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_campaign_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign" text NOT NULL,
	"step" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"segment" text NOT NULL,
	"variant" text NOT NULL,
	"language" text NOT NULL,
	"target" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"provider_message_id" text,
	"error" text,
	"batch_id" text,
	"delivery_status" text,
	"delivery_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "email_suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_campaign_clicks" ADD CONSTRAINT "email_campaign_clicks_send_id_email_campaign_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."email_campaign_sends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_campaign_clicks_send_idx" ON "email_campaign_clicks" USING btree ("send_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_sends_uq" ON "email_campaign_sends" USING btree ("campaign","step","user_id");--> statement-breakpoint
CREATE INDEX "email_campaign_sends_user_idx" ON "email_campaign_sends" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_campaign_sends_sent_idx" ON "email_campaign_sends" USING btree ("sent_at");