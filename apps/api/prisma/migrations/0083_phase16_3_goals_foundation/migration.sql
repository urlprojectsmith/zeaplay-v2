ALTER TYPE "AutomationTriggerType" ADD VALUE IF NOT EXISTS 'GOAL_COMPLETED';
ALTER TYPE "AutomationActionType" ADD VALUE IF NOT EXISTS 'GOAL_PROGRESS_UPDATE';
ALTER TYPE "AutomationDomainEventEntityType" ADD VALUE IF NOT EXISTS 'GOAL';

CREATE TYPE "GoalOwnerType" AS ENUM ('USER', 'DEPARTMENT', 'WORKSPACE');
CREATE TYPE "GoalMetricType" AS ENUM (
  'TASKS_COMPLETED',
  'PROJECTS_COMPLETED',
  'TICKETS_RESOLVED',
  'XP_EARNED',
  'GLOBAL_SCORE',
  'CUSTOM_NUMERIC',
  'MANUAL_NUMERIC'
);
CREATE TYPE "GoalPeriodType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');
CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED', 'ARCHIVED');
CREATE TYPE "GoalProgressSourceType" AS ENUM (
  'TASK',
  'PROJECT',
  'TICKET',
  'XP',
  'GLOBAL_SCORE',
  'CUSTOM',
  'MANUAL',
  'RECONCILIATION'
);

CREATE TABLE "goals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "owner_type" "GoalOwnerType" NOT NULL,
  "owner_membership_id" UUID,
  "department_id" UUID,
  "metric_type" "GoalMetricType" NOT NULL,
  "period_type" "GoalPeriodType" NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "description" VARCHAR(1000),
  "target_value" INTEGER NOT NULL,
  "current_progress" INTEGER NOT NULL DEFAULT 0,
  "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
  "period_start" TIMESTAMPTZ(6) NOT NULL,
  "period_end" TIMESTAMPTZ(6) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "expired_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_by_membership_id" UUID NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goals_target_value_positive_chk" CHECK ("target_value" > 0),
  CONSTRAINT "goals_current_progress_nonnegative_chk" CHECK ("current_progress" >= 0),
  CONSTRAINT "goals_period_order_chk" CHECK ("period_end" > "period_start"),
  CONSTRAINT "goals_owner_shape_chk" CHECK (
    ("owner_type" = 'USER' AND "owner_membership_id" IS NOT NULL AND "department_id" IS NULL) OR
    ("owner_type" = 'DEPARTMENT' AND "owner_membership_id" IS NULL AND "department_id" IS NOT NULL) OR
    ("owner_type" = 'WORKSPACE' AND "owner_membership_id" IS NULL AND "department_id" IS NULL)
  )
);

CREATE TABLE "goal_progress_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "goal_id" UUID NOT NULL,
  "source_type" "GoalProgressSourceType" NOT NULL,
  "source_id" UUID,
  "idempotency_key" VARCHAR(220) NOT NULL,
  "delta" INTEGER NOT NULL,
  "value_after" INTEGER NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "actor_membership_id" UUID,
  "note" VARCHAR(500),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goal_progress_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "goal_progress_events_value_after_nonnegative_chk" CHECK ("value_after" >= 0)
);

CREATE UNIQUE INDEX "goals_id_workspace_id_key" ON "goals"("id", "workspace_id");
CREATE INDEX "goals_workspace_id_status_period_end_idx" ON "goals"("workspace_id", "status", "period_end");
CREATE INDEX "goals_workspace_id_owner_type_status_idx" ON "goals"("workspace_id", "owner_type", "status");
CREATE INDEX "goals_workspace_id_owner_membership_id_status_idx" ON "goals"("workspace_id", "owner_membership_id", "status");
CREATE INDEX "goals_workspace_id_department_id_status_idx" ON "goals"("workspace_id", "department_id", "status");
CREATE INDEX "goals_workspace_id_metric_type_period_start_period_end_idx" ON "goals"("workspace_id", "metric_type", "period_start", "period_end");

CREATE UNIQUE INDEX "goal_progress_events_id_workspace_id_key" ON "goal_progress_events"("id", "workspace_id");
CREATE UNIQUE INDEX "goal_progress_events_goal_id_idempotency_key_key" ON "goal_progress_events"("goal_id", "idempotency_key");
CREATE INDEX "goal_progress_events_workspace_id_goal_id_occurred_at_idx" ON "goal_progress_events"("workspace_id", "goal_id", "occurred_at");
CREATE INDEX "goal_progress_events_workspace_id_source_type_source_id_idx" ON "goal_progress_events"("workspace_id", "source_type", "source_id");
CREATE INDEX "goal_progress_events_workspace_id_actor_membership_id_occurred_at_idx" ON "goal_progress_events"("workspace_id", "actor_membership_id", "occurred_at");

ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_membership_id_workspace_id_fkey" FOREIGN KEY ("owner_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goals" ADD CONSTRAINT "goals_department_id_workspace_id_fkey" FOREIGN KEY ("department_id", "workspace_id") REFERENCES "departments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goals" ADD CONSTRAINT "goals_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goal_progress_events" ADD CONSTRAINT "goal_progress_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goal_progress_events" ADD CONSTRAINT "goal_progress_events_goal_id_workspace_id_fkey" FOREIGN KEY ("goal_id", "workspace_id") REFERENCES "goals"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goal_progress_events" ADD CONSTRAINT "goal_progress_events_actor_membership_id_workspace_id_fkey" FOREIGN KEY ("actor_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
