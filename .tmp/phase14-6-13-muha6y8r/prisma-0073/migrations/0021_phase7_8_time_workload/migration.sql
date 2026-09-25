-- Phase 7.8 - Time Tracking + Workload

CREATE TYPE "TaskTimeEntryType" AS ENUM ('TIMER', 'MANUAL');
CREATE TYPE "TaskTimeEntryStopReason" AS ENUM ('USER', 'SWITCHED_TASK', 'TASK_TERMINAL', 'TASK_DELETED', 'ADMIN');

ALTER TABLE "tasks" ADD COLUMN "estimated_minutes" INTEGER;
ALTER TABLE "task_recurrence_series" ADD COLUMN "estimated_minutes" INTEGER;
ALTER TABLE "task_templates" ADD COLUMN "estimated_minutes" INTEGER;

CREATE TABLE "task_time_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "workspace_membership_id" UUID NOT NULL,
  "entry_type" "TaskTimeEntryType" NOT NULL,
  "started_at" TIMESTAMPTZ(6) NOT NULL,
  "ended_at" TIMESTAMPTZ(6),
  "duration_seconds" INTEGER,
  "stop_reason" "TaskTimeEntryStopReason",
  "created_by_membership_id" UUID NOT NULL,
  "updated_by_membership_id" UUID,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_time_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_workload_allocations" (
  "task_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "workspace_membership_id" UUID NOT NULL,
  "planned_minutes" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_workload_allocations_pkey" PRIMARY KEY ("task_id", "workspace_membership_id")
);

CREATE TABLE "workspace_member_capacities" (
  "workspace_id" UUID NOT NULL,
  "workspace_membership_id" UUID NOT NULL,
  "weekly_capacity_minutes" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_member_capacities_pkey" PRIMARY KEY ("workspace_id", "workspace_membership_id")
);

CREATE UNIQUE INDEX "task_time_entries_id_workspace_id_key" ON "task_time_entries"("id", "workspace_id");
CREATE UNIQUE INDEX "task_time_entries_one_running_timer_per_user_idx"
  ON "task_time_entries"("user_id")
  WHERE "ended_at" IS NULL AND "deleted_at" IS NULL AND "entry_type" = 'TIMER';

CREATE INDEX "idx_task_time_entries_workspace_task_started" ON "task_time_entries"("workspace_id", "task_id", "started_at");
CREATE INDEX "idx_task_time_entries_workspace_membership_started" ON "task_time_entries"("workspace_id", "workspace_membership_id", "started_at");
CREATE INDEX "idx_task_time_entries_workspace_started" ON "task_time_entries"("workspace_id", "started_at");
CREATE INDEX "idx_task_time_entries_user_running_lookup" ON "task_time_entries"("user_id", "entry_type", "ended_at", "deleted_at");
CREATE INDEX "tasks_workspace_id_estimated_minutes_idx" ON "tasks"("workspace_id", "estimated_minutes");
CREATE INDEX "task_workload_allocations_workspace_membership_idx" ON "task_workload_allocations"("workspace_id", "workspace_membership_id");
CREATE INDEX "workspace_member_capacities_workspace_id_idx" ON "workspace_member_capacities"("workspace_id");

ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_task_id_workspace_id_fkey" FOREIGN KEY ("task_id", "workspace_id") REFERENCES "tasks"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_workspace_membership_id_workspace_id_fkey" FOREIGN KEY ("workspace_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_created_by_membership_id_workspace_id_fkey" FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_updated_by_membership_id_workspace_id_fkey" FOREIGN KEY ("updated_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_deleted_by_membership_id_workspace_id_fkey" FOREIGN KEY ("deleted_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_nonnegative_duration_chk" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);
ALTER TABLE "task_time_entries" ADD CONSTRAINT "task_time_entries_manual_completed_chk" CHECK ("entry_type" <> 'MANUAL' OR ("ended_at" IS NOT NULL AND "duration_seconds" IS NOT NULL));

ALTER TABLE "task_workload_allocations" ADD CONSTRAINT "task_workload_allocations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_workload_allocations" ADD CONSTRAINT "task_workload_allocations_task_id_workspace_id_fkey" FOREIGN KEY ("task_id", "workspace_id") REFERENCES "tasks"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_workload_allocations" ADD CONSTRAINT "task_workload_allocations_workspace_membership_id_workspace_id_fkey" FOREIGN KEY ("workspace_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_workload_allocations" ADD CONSTRAINT "task_workload_allocations_nonnegative_minutes_chk" CHECK ("planned_minutes" >= 0);

ALTER TABLE "workspace_member_capacities" ADD CONSTRAINT "workspace_member_capacities_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_member_capacities" ADD CONSTRAINT "workspace_member_capacities_workspace_membership_id_workspace_id_fkey" FOREIGN KEY ("workspace_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_member_capacities" ADD CONSTRAINT "workspace_member_capacities_nonnegative_minutes_chk" CHECK ("weekly_capacity_minutes" >= 0);
CREATE UNIQUE INDEX "workspace_member_capacities_workspace_membership_id_workspace_id_key" ON "workspace_member_capacities"("workspace_membership_id", "workspace_id");
