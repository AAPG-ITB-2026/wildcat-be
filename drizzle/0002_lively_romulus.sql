CREATE TYPE "public"."target_audience" AS ENUM('All', 'Paper_Poster', 'BCC', 'GnG', 'HighSchool');
CREATE TYPE "public"."role" AS ENUM('Admin', 'Committee');
CREATE TYPE "public"."verification_status" AS ENUM('Pending', 'Verified', 'Rejected');
CREATE TABLE "committee_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" "role" NOT NULL,
	"division" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);

CREATE TABLE "competition_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"competition_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL
);

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

CREATE TABLE "stage_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"document_name" varchar(255) NOT NULL,
	"allowed_extensions" varchar(100) NOT NULL,
	"max_size_mb" integer NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL
);

CREATE TABLE "stage_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"final_score" double precision NOT NULL,
	"feedback" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

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

ALTER TABLE "app_config" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "app_content" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "members" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "teams" DISABLE ROW LEVEL SECURITY;
DROP TABLE "app_config" CASCADE;
DROP TABLE "app_content" CASCADE;
DROP TABLE "documents" CASCADE;
DROP TABLE "members" CASCADE;
DROP TABLE "payments" CASCADE;
DROP TABLE "teams" CASCADE;
ALTER TABLE "submissions" RENAME COLUMN "submission_url" TO "file_url";
ALTER TABLE "submissions" RENAME COLUMN "created_at" TO "submitted_at";
ALTER TABLE "submissions" DROP CONSTRAINT "submissions_team_id_teams_id_fk";

ALTER TABLE "announcements" ALTER COLUMN "title" SET DATA TYPE varchar(255);
ALTER TABLE "announcements" ALTER COLUMN "created_at" SET NOT NULL;
ALTER TABLE "announcements" ADD COLUMN "author_id" uuid NOT NULL;
ALTER TABLE "announcements" ADD COLUMN "content" text NOT NULL;
ALTER TABLE "announcements" ADD COLUMN "target_audience" "target_audience" NOT NULL;
ALTER TABLE "announcements" ADD COLUMN "attachment_url" text;
ALTER TABLE "announcements" ADD COLUMN "scheduled_for" timestamp;
ALTER TABLE "submissions" ADD COLUMN "requirement_id" uuid NOT NULL;
ALTER TABLE "submissions" ADD COLUMN "is_valid" boolean DEFAULT false NOT NULL;
ALTER TABLE "submissions" ADD COLUMN "verified_by" uuid;
ALTER TABLE "competition_stages" ADD CONSTRAINT "competition_stages_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "events" ADD CONSTRAINT "events_author_id_committee_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stage_requirements" ADD CONSTRAINT "stage_requirements_stage_id_competition_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."competition_stages"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stage_scores" ADD CONSTRAINT "stage_scores_team_id_team_accounts_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stage_scores" ADD CONSTRAINT "stage_scores_stage_id_competition_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."competition_stages"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "team_accounts" ADD CONSTRAINT "team_accounts_competition_id_competitions_id_fk" FOREIGN KEY ("competition_id") REFERENCES "public"."competitions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "team_accounts" ADD CONSTRAINT "team_accounts_current_stage_id_competition_stages_id_fk" FOREIGN KEY ("current_stage_id") REFERENCES "public"."competition_stages"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "team_administration" ADD CONSTRAINT "team_administration_team_id_team_accounts_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "team_administration" ADD CONSTRAINT "team_administration_verified_by_committee_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_team_id_team_accounts_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_verified_by_committee_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_committee_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_team_id_team_accounts_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_requirement_id_stage_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."stage_requirements"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_verified_by_committee_accounts_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."committee_accounts"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "announcements" DROP COLUMN "message";
ALTER TABLE "announcements" DROP COLUMN "metadata";
ALTER TABLE "submissions" DROP COLUMN "score";
ALTER TABLE "submissions" DROP COLUMN "feedback";
DROP TYPE "public"."category";
DROP TYPE "public"."status";
DROP TYPE "public"."transaction_status";