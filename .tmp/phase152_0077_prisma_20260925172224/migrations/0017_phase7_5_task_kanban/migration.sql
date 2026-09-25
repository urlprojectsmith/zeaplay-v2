ALTER TABLE "tasks" ADD COLUMN "kanban_rank" DECIMAL(30,12);

CREATE TABLE "task_kanban_column_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "status_definition_id" UUID NOT NULL,
  "wip_limit" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "task_kanban_column_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_kanban_column_settings_wip_limit_check" CHECK ("wip_limit" IS NULL OR ("wip_limit" >= 1 AND "wip_limit" <= 999))
);

CREATE UNIQUE INDEX "task_kanban_column_settings_workspace_id_status_definition_id_key"
  ON "task_kanban_column_settings"("workspace_id", "status_definition_id");

CREATE INDEX "task_kanban_column_settings_workspace_id_idx"
  ON "task_kanban_column_settings"("workspace_id");

CREATE INDEX "tasks_workspace_id_status_definition_id_kanban_rank_created_at_idx"
  ON "tasks"("workspace_id", "status_definition_id", "kanban_rank", "created_at");

ALTER TABLE "task_kanban_column_settings"
  ADD CONSTRAINT "task_kanban_column_settings_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_kanban_column_settings"
  ADD CONSTRAINT "task_kanban_column_settings_status_definition_id_workspace_id_fkey"
  FOREIGN KEY ("status_definition_id", "workspace_id") REFERENCES "status_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
