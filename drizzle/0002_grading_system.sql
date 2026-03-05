
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'Judge';

ALTER TABLE "competition_stages"
  ADD COLUMN IF NOT EXISTS "is_scores_released" boolean NOT NULL DEFAULT false;

ALTER TABLE "stage_scores"
  ADD COLUMN IF NOT EXISTS "judge_id" uuid REFERENCES "committee_accounts"("id");

ALTER TABLE "stage_scores"
  RENAME COLUMN "final_score" TO "score";

ALTER TABLE "stage_scores"
  ALTER COLUMN "judge_id" SET NOT NULL;

ALTER TABLE "stage_scores"
  ADD CONSTRAINT "uq_stage_scores_team_stage_judge"
  UNIQUE ("team_id", "stage_id", "judge_id");
