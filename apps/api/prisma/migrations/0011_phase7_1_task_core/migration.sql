-- Phase 7.1 task core backend foundation.
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TABLE "tasks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "description" VARCHAR(4000),
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "status_definition_id" UUID NOT NULL,
  "department_id" UUID,
  "due_at" TIMESTAMPTZ(6),
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_assignees" (
  "task_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id", "membership_id")
);

CREATE TABLE "task_followers" (
  "task_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_followers_pkey" PRIMARY KEY ("task_id", "membership_id")
);

CREATE TABLE "task_projects" (
  "task_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_projects_pkey" PRIMARY KEY ("task_id", "project_id")
);

CREATE UNIQUE INDEX "workspace_memberships_id_workspace_id_key"
  ON "workspace_memberships"("id", "workspace_id");

CREATE UNIQUE INDEX "tasks_id_workspace_id_key"
  ON "tasks"("id", "workspace_id");

CREATE INDEX "tasks_workspace_id_status_definition_id_created_at_idx"
  ON "tasks"("workspace_id", "status_definition_id", "created_at");

CREATE INDEX "tasks_workspace_id_priority_created_at_idx"
  ON "tasks"("workspace_id", "priority", "created_at");

CREATE INDEX "tasks_workspace_id_due_at_idx"
  ON "tasks"("workspace_id", "due_at");

CREATE INDEX "tasks_workspace_id_department_id_idx"
  ON "tasks"("workspace_id", "department_id");

CREATE INDEX "tasks_workspace_id_created_at_idx"
  ON "tasks"("workspace_id", "created_at");

CREATE INDEX "tasks_workspace_id_created_by_id_idx"
  ON "tasks"("workspace_id", "created_by_id");

CREATE INDEX "task_assignees_workspace_id_membership_id_idx"
  ON "task_assignees"("workspace_id", "membership_id");

CREATE INDEX "task_followers_workspace_id_membership_id_idx"
  ON "task_followers"("workspace_id", "membership_id");

CREATE INDEX "task_projects_workspace_id_project_id_idx"
  ON "task_projects"("workspace_id", "project_id");

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_status_definition_id_workspace_id_fkey"
  FOREIGN KEY ("status_definition_id", "workspace_id")
  REFERENCES "status_definitions"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_department_id_workspace_id_fkey"
  FOREIGN KEY ("department_id", "workspace_id")
  REFERENCES "departments"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "task_assignees"
  ADD CONSTRAINT "task_assignees_task_id_workspace_id_fkey"
  FOREIGN KEY ("task_id", "workspace_id")
  REFERENCES "tasks"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_assignees"
  ADD CONSTRAINT "task_assignees_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_assignees"
  ADD CONSTRAINT "task_assignees_membership_id_workspace_id_fkey"
  FOREIGN KEY ("membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_followers"
  ADD CONSTRAINT "task_followers_task_id_workspace_id_fkey"
  FOREIGN KEY ("task_id", "workspace_id")
  REFERENCES "tasks"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_followers"
  ADD CONSTRAINT "task_followers_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_followers"
  ADD CONSTRAINT "task_followers_membership_id_workspace_id_fkey"
  FOREIGN KEY ("membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_projects"
  ADD CONSTRAINT "task_projects_task_id_workspace_id_fkey"
  FOREIGN KEY ("task_id", "workspace_id")
  REFERENCES "tasks"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_projects"
  ADD CONSTRAINT "task_projects_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_projects"
  ADD CONSTRAINT "task_projects_project_id_workspace_id_fkey"
  FOREIGN KEY ("project_id", "workspace_id")
  REFERENCES "projects"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
