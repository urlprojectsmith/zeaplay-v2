CREATE TYPE "GamificationWorkXpEventType" AS ENUM (
  'CREATION_AWARD',
  'CREATION_REVERSAL',
  'COMPLETION_AWARD',
  'COMPLETION_REVERSAL'
);

CREATE TYPE "GamificationWorkXpEventOutcome" AS ENUM ('APPLIED', 'SKIPPED');

CREATE TYPE "GamificationWorkXpSkipReason" AS ENUM (
  'NOT_CONFIGURED',
  'RULE_DISABLED',
  'MISSING_CATEGORY',
  'INACTIVE_RECIPIENT',
  'NO_ELIGIBLE_CREATOR',
  'AMBIGUOUS_ROLE',
  'NO_PRIOR_AWARD',
  'ALREADY_REVERSED',
  'ALREADY_NEUTRALIZED_BY_RESET',
  'REVERSAL_CONFLICT'
);

CREATE TABLE "gamification_work_xp_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "recipient_membership_id" UUID,
  "triggered_by_membership_id" UUID,
  "work_type" "GamificationPointWorkType" NOT NULL,
  "source_entity_id" UUID NOT NULL,
  "source_label_snapshot" VARCHAR(160),
  "event_type" "GamificationWorkXpEventType" NOT NULL,
  "completion_cycle" INTEGER,
  "correlation_key" VARCHAR(220) NOT NULL,
  "idempotency_key" VARCHAR(220) NOT NULL,
  "department_id_snapshot" UUID,
  "department_name_snapshot" VARCHAR(160),
  "category_snapshot" "GamificationPointCategory",
  "role_id_snapshot" UUID,
  "role_name_snapshot" VARCHAR(160),
  "rule_id_snapshot" UUID,
  "rule_source_snapshot" VARCHAR(40) NOT NULL DEFAULT 'NOT_CONFIGURED',
  "outcome" "GamificationWorkXpEventOutcome" NOT NULL,
  "skip_reason" "GamificationWorkXpSkipReason",
  "creation_xp_snapshot" INTEGER,
  "base_xp_snapshot" INTEGER NOT NULL DEFAULT 0,
  "bonus_xp_snapshot" INTEGER NOT NULL DEFAULT 0,
  "penalty_xp_snapshot" INTEGER NOT NULL DEFAULT 0,
  "net_xp_snapshot" INTEGER NOT NULL DEFAULT 0,
  "early_threshold_minutes_snapshot" INTEGER,
  "late_penalty_percent_snapshot" INTEGER,
  "penalty_interval_minutes_snapshot" INTEGER,
  "max_penalty_xp_snapshot" INTEGER,
  "due_at_snapshot" TIMESTAMPTZ(6),
  "completed_at_snapshot" TIMESTAMPTZ(6),
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "reversal_of_event_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_work_xp_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_work_xp_events_key_nonblank" CHECK (btrim("idempotency_key") <> '' AND btrim("correlation_key") <> ''),
  CONSTRAINT "gamification_work_xp_events_applied_skip_check" CHECK (
    ("outcome" = 'APPLIED' AND "skip_reason" IS NULL)
    OR ("outcome" = 'SKIPPED' AND "skip_reason" IS NOT NULL)
  ),
  CONSTRAINT "gamification_work_xp_events_cycle_check" CHECK ("completion_cycle" IS NULL OR "completion_cycle" > 0)
);

CREATE UNIQUE INDEX "gamification_work_xp_events_id_workspace_key"
  ON "gamification_work_xp_events" ("id", "workspace_id");

CREATE UNIQUE INDEX "gamification_work_xp_events_workspace_idempotency_key"
  ON "gamification_work_xp_events" ("workspace_id", "idempotency_key");

CREATE INDEX "gamification_work_xp_events_source_idx"
  ON "gamification_work_xp_events" ("workspace_id", "work_type", "source_entity_id", "event_type", "completion_cycle");

CREATE INDEX "gamification_work_xp_events_recipient_idx"
  ON "gamification_work_xp_events" ("workspace_id", "recipient_membership_id", "occurred_at", "id");

CREATE INDEX "gamification_work_xp_events_triggered_by_idx"
  ON "gamification_work_xp_events" ("workspace_id", "triggered_by_membership_id");

CREATE INDEX "gamification_work_xp_events_reversal_idx"
  ON "gamification_work_xp_events" ("reversal_of_event_id");

ALTER TABLE "gamification_work_xp_events"
  ADD CONSTRAINT "gamification_work_xp_events_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_work_xp_events"
  ADD CONSTRAINT "gamification_work_xp_events_recipient_fkey"
  FOREIGN KEY ("recipient_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_work_xp_events"
  ADD CONSTRAINT "gamification_work_xp_events_triggered_by_fkey"
  FOREIGN KEY ("triggered_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_work_xp_events"
  ADD CONSTRAINT "gamification_work_xp_events_reversal_fkey"
  FOREIGN KEY ("reversal_of_event_id") REFERENCES "gamification_work_xp_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_xp_entries"
  ADD COLUMN "work_xp_event_id" UUID;

CREATE INDEX "gamification_xp_entries_work_xp_event_idx"
  ON "gamification_xp_entries" ("workspace_id", "work_xp_event_id");

ALTER TABLE "gamification_xp_entries"
  ADD CONSTRAINT "gamification_xp_entries_work_xp_event_fkey"
  FOREIGN KEY ("work_xp_event_id", "workspace_id") REFERENCES "gamification_work_xp_events"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD COLUMN "gamification_resolution_target_at" TIMESTAMPTZ(6);

CREATE INDEX "tickets_workspace_gamification_resolution_target_idx"
  ON "tickets" ("workspace_id", "gamification_resolution_target_at");

CREATE OR REPLACE FUNCTION prevent_gamification_work_xp_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gamification_work_xp_events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gamification_work_xp_events_immutable"
BEFORE UPDATE OR DELETE ON "gamification_work_xp_events"
FOR EACH ROW EXECUTE FUNCTION prevent_gamification_work_xp_event_mutation();
