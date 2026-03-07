CREATE TYPE "public"."target_audience" AS ENUM('All', 'Paper_Poster', 'BCC', 'GnG', 'HighSchool');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('Admin', 'Committee');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('Pending', 'Verified', 'Rejected');--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"target_audience" "target_audience" NOT NULL,
	"attachment_url" text,
	"scheduled_for" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" varchar(100) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_content" (
	"section" varchar(100) PRIMARY KEY NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "committee_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" "role" NOT NULL,
	"division" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competition_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"min_members" integer NOT NULL,
	"max_members" integer NOT NULL,
	"early_bird_fee" numeric(12, 2) NOT NULL,
	"normal_bird_fee" numeric(12, 2) NOT NULL,
	"early_bird_deadline" timestamp NOT NULL,
	"guidebook_url" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"datetime" timestamp NOT NULL,
	"location" varchar(255) NOT NULL,
	"speaker" varchar(255),
	"registration_link" text NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"author_id" uuid NOT NULL,
	"registered_count" integer DEFAULT 0 NOT NULL,
	"attended_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"document_name" varchar(255) NOT NULL,
	"allowed_extensions" varchar(100) NOT NULL,
	"max_size_mb" integer NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"final_score" double precision NOT NULL,
	"feedback" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"requirement_id" uuid NOT NULL,
	"file_url" text NOT NULL,
	"is_valid" boolean DEFAULT false NOT NULL,
	"verified_by" uuid,
	"submitted_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"competition_id" uuid NOT NULL,
	"current_stage_id" uuid,
	"team_name" varchar(255) NOT NULL,
	"institution" varchar(255) NOT NULL,
	"phone_number" varchar(50) NOT NULL,
	"line_id" varchar(100) NOT NULL,
	"lead_name" varchar(255) NOT NULL,
	"lead_major" varchar(255) NOT NULL,
	"m1_name" varchar(255),
	"m1_major" varchar(255),
	"m2_name" varchar(255),
	"m2_major" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_administration" (
	"team_id" uuid PRIMARY KEY NOT NULL,
	"lead_ktm" text,
	"m1_ktm" text,
	"m2_ktm" text,
	"twibbon_proof" text,
	"poster_proof" text,
	"verification_status" "verification_status" DEFAULT 'Pending' NOT NULL,
	"verified_by" uuid,
	"rejection_notes" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"order_id" varchar(255) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"payment_type" varchar(100) NOT NULL,
	"payment_proof_url" text,
	"verification_status" "verification_status" DEFAULT 'Pending' NOT NULL,
	"verified_by" uuid,
	"rejection_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_committee_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competition_stages" ADD CONSTRAINT "competition_stages_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_author_id_committee_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_requirements" ADD CONSTRAINT "stage_requirements_stage_id_competition_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."competition_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_scores" ADD CONSTRAINT "stage_scores_team_id_team_accounts_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_scores" ADD CONSTRAINT "stage_scores_stage_id_competition_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."competition_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_team_id_team_accounts_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_requirement_id_stage_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."stage_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_verified_by_committee_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_accounts" ADD CONSTRAINT "team_accounts_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_accounts" ADD CONSTRAINT "team_accounts_current_stage_id_competition_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."competition_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_administration" ADD CONSTRAINT "team_administration_team_id_team_accounts_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_administration" ADD CONSTRAINT "team_administration_verified_by_committee_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_team_id_team_accounts_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_verified_by_committee_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;