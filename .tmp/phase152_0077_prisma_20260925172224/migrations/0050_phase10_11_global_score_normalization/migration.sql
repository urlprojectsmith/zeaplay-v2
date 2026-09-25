CREATE TYPE "GamificationGlobalScoreBaselineScoreType" AS ENUM ('CREATION', 'COMPLETION');
CREATE TYPE "GamificationGlobalScoreBaselineStatus" AS ENUM ('READY', 'INSUFFICIENT_SAMPLE');
CREATE TYPE "GamificationGlobalScoreEventScoreType" AS ENUM ('CREATION', 'COMPLETION', 'REVERSAL');
CREATE TYPE "GamificationGlobalScoreEventStatus" AS ENUM ('APPLIED', 'SKIPPED_INSUFFICIENT_SAMPLE', 'SKIPPED_NO_BASELINE', 'SKIPPED_UNSUPPORTED_EVENT');

CREATE TABLE "gamification_global_score_baselines" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "baseline_version" UUID NOT NULL,
  "work_type" "GamificationPointWorkType" NOT NULL,
  "category" "GamificationPointCategory" NOT NULL,
  "score_type" "GamificationGlobalScoreBaselineScoreType" NOT NULL,
  "status" "GamificationGlobalScoreBaselineStatus" NOT NULL,
  "eligible_workspace_count" INTEGER NOT NULL,
  "normalized_creation_xp" INTEGER,
  "normalized_base_xp" INTEGER,
  "normalized_early_bonus_xp" INTEGER,
  "normalized_early_threshold_minutes" INTEGER,
  "normalized_late_penalty_percent" INTEGER,
  "normalized_penalty_interval_minutes" INTEGER,
  "normalized_max_penalty_xp" INTEGER,
  "calculated_at" TIMESTAMPTZ(6) NOT NULL,
  "calculation_version" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_global_score_baselines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_global_score_baselines_workspace_count_nonnegative" CHECK ("eligible_workspace_count" >= 0),
  CONSTRAINT "gamification_global_score_baselines_ready_fields" CHECK (
    (
      "status" = 'READY'
      AND (
        (
          "score_type" = 'CREATION'
          AND "normalized_creation_xp" IS NOT NULL
          AND "normalized_base_xp" IS NULL
          AND "normalized_early_bonus_xp" IS NULL
          AND "normalized_early_threshold_minutes" IS NULL
          AND "normalized_late_penalty_percent" IS NULL
          AND "normalized_penalty_interval_minutes" IS NULL
          AND "normalized_max_penalty_xp" IS NULL
        )
        OR
        (
          "score_type" = 'COMPLETION'
          AND "normalized_creation_xp" IS NULL
          AND "normalized_base_xp" IS NOT NULL
          AND "normalized_early_bonus_xp" IS NOT NULL
          AND "normalized_early_threshold_minutes" IS NOT NULL
          AND "normalized_late_penalty_percent" IS NOT NULL
          AND "normalized_penalty_interval_minutes" IS NOT NULL
          AND "normalized_max_penalty_xp" IS NOT NULL
        )
      )
    )
    OR
    (
      "status" = 'INSUFFICIENT_SAMPLE'
      AND "normalized_creation_xp" IS NULL
      AND "normalized_base_xp" IS NULL
      AND "normalized_early_bonus_xp" IS NULL
      AND "normalized_early_threshold_minutes" IS NULL
      AND "normalized_late_penalty_percent" IS NULL
      AND "normalized_penalty_interval_minutes" IS NULL
      AND "normalized_max_penalty_xp" IS NULL
    )
  )
);

CREATE UNIQUE INDEX "gamification_global_score_baselines_version_key"
  ON "gamification_global_score_baselines" ("baseline_version");

CREATE INDEX "gamification_global_score_baselines_latest_idx"
  ON "gamification_global_score_baselines" ("score_type", "work_type", "category", "status", "calculated_at", "id");

CREATE INDEX "gamification_global_score_baselines_bucket_idx"
  ON "gamification_global_score_baselines" ("work_type", "category", "score_type", "created_at");

CREATE TABLE "gamification_global_score_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "recipient_membership_id" UUID,
  "work_xp_event_id" UUID NOT NULL,
  "work_type" "GamificationPointWorkType" NOT NULL,
  "source_entity_id" UUID NOT NULL,
  "event_type" "GamificationWorkXpEventType" NOT NULL,
  "score_type" "GamificationGlobalScoreEventScoreType" NOT NULL,
  "category_snapshot" "GamificationPointCategory",
  "baseline_id" UUID,
  "baseline_version_snapshot" UUID,
  "eligible_workspace_count_snapshot" INTEGER,
  "normalized_creation_xp_snapshot" INTEGER,
  "normalized_base_xp_snapshot" INTEGER,
  "normalized_bonus_xp_snapshot" INTEGER,
  "normalized_penalty_xp_snapshot" INTEGER,
  "normalized_score" INTEGER,
  "status" "GamificationGlobalScoreEventStatus" NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "reversal_of_global_score_event_id" UUID,
  "idempotency_key" VARCHAR(220) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_global_score_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_global_score_events_applied_score_check" CHECK (
    ("status" = 'APPLIED' AND "normalized_score" IS NOT NULL)
    OR
    ("status" <> 'APPLIED' AND "normalized_score" IS NULL)
  )
);

CREATE UNIQUE INDEX "gamification_global_score_events_work_xp_event_key"
  ON "gamification_global_score_events" ("work_xp_event_id");

CREATE UNIQUE INDEX "gamification_global_score_events_work_workspace_key"
  ON "gamification_global_score_events" ("work_xp_event_id", "workspace_id");

CREATE UNIQUE INDEX "gamification_global_score_events_reversal_key"
  ON "gamification_global_score_events" ("reversal_of_global_score_event_id");

CREATE UNIQUE INDEX "gamification_global_score_events_idempotency_key"
  ON "gamification_global_score_events" ("idempotency_key");

CREATE INDEX "gamification_global_score_events_member_idx"
  ON "gamification_global_score_events" ("workspace_id", "recipient_membership_id", "occurred_at", "id");

CREATE INDEX "gamification_global_score_events_workspace_idx"
  ON "gamification_global_score_events" ("workspace_id", "occurred_at", "id");

CREATE INDEX "gamification_global_score_events_baseline_idx"
  ON "gamification_global_score_events" ("baseline_id");

CREATE INDEX "gamification_global_score_events_source_idx"
  ON "gamification_global_score_events" ("workspace_id", "work_type", "source_entity_id", "event_type");

ALTER TABLE "gamification_global_score_events"
  ADD CONSTRAINT "gamification_global_score_events_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_global_score_events"
  ADD CONSTRAINT "gamification_global_score_events_recipient_fkey"
  FOREIGN KEY ("recipient_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_global_score_events"
  ADD CONSTRAINT "gamification_global_score_events_work_xp_event_fkey"
  FOREIGN KEY ("work_xp_event_id", "workspace_id") REFERENCES "gamification_work_xp_events"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_global_score_events"
  ADD CONSTRAINT "gamification_global_score_events_baseline_fkey"
  FOREIGN KEY ("baseline_id") REFERENCES "gamification_global_score_baselines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_global_score_events"
  ADD CONSTRAINT "gamification_global_score_events_reversal_fkey"
  FOREIGN KEY ("reversal_of_global_score_event_id") REFERENCES "gamification_global_score_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_gamification_global_score_baseline_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gamification_global_score_baselines are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gamification_global_score_baselines_immutable"
BEFORE UPDATE OR DELETE ON "gamification_global_score_baselines"
FOR EACH ROW EXECUTE FUNCTION prevent_gamification_global_score_baseline_mutation();

CREATE OR REPLACE FUNCTION prevent_gamification_global_score_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gamification_global_score_events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gamification_global_score_events_immutable"
BEFORE UPDATE OR DELETE ON "gamification_global_score_events"
FOR EACH ROW EXECUTE FUNCTION prevent_gamification_global_score_event_mutation();
