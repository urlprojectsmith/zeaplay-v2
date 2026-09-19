-- Phase 7.9 Task Views - nullable Gantt scheduling boundary

ALTER TABLE "tasks"
  ADD COLUMN "planned_start_at" TIMESTAMPTZ(6);

CREATE INDEX "tasks_workspace_id_planned_start_at_due_at_idx"
  ON "tasks" ("workspace_id", "planned_start_at", "due_at");
