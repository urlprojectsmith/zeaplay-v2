ALTER TABLE "tasks"
  ADD COLUMN "parent_task_id" UUID;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_parent_task_id_workspace_id_fkey"
  FOREIGN KEY ("parent_task_id", "workspace_id")
  REFERENCES "tasks"("id", "workspace_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_parent_not_self_check"
  CHECK ("parent_task_id" IS NULL OR "parent_task_id" <> "id");

CREATE INDEX "tasks_workspace_id_parent_task_id_created_at_idx"
  ON "tasks"("workspace_id", "parent_task_id", "created_at");
