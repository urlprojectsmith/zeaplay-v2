CREATE TABLE "task_dependencies" (
  "workspace_id" UUID NOT NULL,
  "blocker_task_id" UUID NOT NULL,
  "blocked_task_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("blocker_task_id", "blocked_task_id"),
  CONSTRAINT "task_dependencies_not_self_check" CHECK ("blocker_task_id" <> "blocked_task_id")
);

CREATE TABLE "task_related_tasks" (
  "workspace_id" UUID NOT NULL,
  "task_a_id" UUID NOT NULL,
  "task_b_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_related_tasks_pkey" PRIMARY KEY ("task_a_id", "task_b_id"),
  CONSTRAINT "task_related_tasks_not_self_check" CHECK ("task_a_id" <> "task_b_id"),
  CONSTRAINT "task_related_tasks_canonical_check" CHECK ("task_a_id" < "task_b_id")
);

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_workspace_id_fkey"
  FOREIGN KEY ("workspace_id")
  REFERENCES "workspaces"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_blocker_task_id_workspace_id_fkey"
  FOREIGN KEY ("blocker_task_id", "workspace_id")
  REFERENCES "tasks"("id", "workspace_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_blocked_task_id_workspace_id_fkey"
  FOREIGN KEY ("blocked_task_id", "workspace_id")
  REFERENCES "tasks"("id", "workspace_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_created_by_id_fkey"
  FOREIGN KEY ("created_by_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "task_related_tasks"
  ADD CONSTRAINT "task_related_tasks_workspace_id_fkey"
  FOREIGN KEY ("workspace_id")
  REFERENCES "workspaces"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "task_related_tasks"
  ADD CONSTRAINT "task_related_tasks_task_a_id_workspace_id_fkey"
  FOREIGN KEY ("task_a_id", "workspace_id")
  REFERENCES "tasks"("id", "workspace_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "task_related_tasks"
  ADD CONSTRAINT "task_related_tasks_task_b_id_workspace_id_fkey"
  FOREIGN KEY ("task_b_id", "workspace_id")
  REFERENCES "tasks"("id", "workspace_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

ALTER TABLE "task_related_tasks"
  ADD CONSTRAINT "task_related_tasks_created_by_id_fkey"
  FOREIGN KEY ("created_by_id")
  REFERENCES "users"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE INDEX "task_dependencies_workspace_id_blocker_task_id_created_at_idx"
  ON "task_dependencies"("workspace_id", "blocker_task_id", "created_at");

CREATE INDEX "task_dependencies_workspace_id_blocked_task_id_created_at_idx"
  ON "task_dependencies"("workspace_id", "blocked_task_id", "created_at");

CREATE INDEX "task_related_tasks_workspace_id_task_a_id_created_at_idx"
  ON "task_related_tasks"("workspace_id", "task_a_id", "created_at");

CREATE INDEX "task_related_tasks_workspace_id_task_b_id_created_at_idx"
  ON "task_related_tasks"("workspace_id", "task_b_id", "created_at");
