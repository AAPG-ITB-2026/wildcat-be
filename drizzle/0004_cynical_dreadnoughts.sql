CREATE TABLE IF NOT EXISTS "app_config" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_content" (
	"section" varchar(100) PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_registration_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "target_audience" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."target_audience";--> statement-breakpoint
CREATE TYPE "public"."target_audience" AS ENUM('All', 'Paper and Poster Case Competition', 'Business Case Competition', 'Geology and Geophysics Case Study Competition (GnG)', 'Highschool Essay Competition');--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "target_audience" SET DATA TYPE "public"."target_audience" USING "target_audience"::"public"."target_audience";--> statement-breakpoint
ALTER TABLE "event_registration_logs" ADD CONSTRAINT "event_registration_logs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_logs_created_at_idx" ON "event_registration_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "announcements_audience_created_idx" ON "announcements" USING btree ("target_audience","created_at");--> statement-breakpoint
CREATE INDEX "team_accounts_competition_idx" ON "team_accounts" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "team_accounts_created_at_idx" ON "team_accounts" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "transactions_team_verification_idx" ON "transactions" USING btree ("team_id","verification_status");