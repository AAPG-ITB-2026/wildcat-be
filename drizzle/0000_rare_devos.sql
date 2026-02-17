CREATE TYPE "public"."category" AS ENUM('Wildcat', 'Smart_Competition', 'Paper_Competition');--> statement-breakpoint
CREATE TYPE "public"."status" AS ENUM('Registered', 'Document_Verified', 'Paid');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('settlement', 'pending', 'deny', 'cancel', 'expire', 'failure');--> statement-breakpoint
CREATE TABLE "app_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section" text NOT NULL,
	"content" text NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "app_content_section_unique" UNIQUE("section")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"file_url" text NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp,
	"rejection_note" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"major" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"order_id" text NOT NULL,
	"gross_amount" numeric(12, 2) NOT NULL,
	"transaction_status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"payment_type" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "payments_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"submission_url" text NOT NULL,
	"score" real,
	"feedback" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"team_name" text NOT NULL,
	"leader_name" text NOT NULL,
	"university" text NOT NULL,
	"leader_major" text NOT NULL,
	"category" "category" NOT NULL,
	"status" "status" DEFAULT 'Registered' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "teams_team_name_unique" UNIQUE("team_name")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;