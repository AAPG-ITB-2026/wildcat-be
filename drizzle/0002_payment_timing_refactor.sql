-- Refactor payments table: replace gross_amount/created_at with creation_time/expiration_time
ALTER TABLE "payments" ADD COLUMN "snap_token" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "creation_time" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
-- Temporarily nullable to allow migration on existing rows; app always sets this on insert
ALTER TABLE "payments" ADD COLUMN "expiration_time" timestamp;--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN IF EXISTS "gross_amount";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN IF EXISTS "created_at";
