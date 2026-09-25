-- Phase 11.1 Automation core and workflow model.

CREATE TYPE "AutomationWorkflowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISABLED', 'ARCHIVED');
CREATE TYPE "AutomationWorkflowVersionState" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "AutomationWorkflowNodeType" AS ENUM ('TRIGGER', 'CONDITION', 'ACTION', 'DELAY', 'BRANCH');
CREATE TYPE "AutomationTriggerType" AS ENUM (
  'TASK_CREATED',
  'TASK_STATUS_CHANGED',
  'TASK_COMPLETED',
  'PROJECT_CREATED',
  'PROJECT_STATUS_CHANGED',
  'PROJECT_COMPLETED',
  'TICKET_CREATED',
  'TICKET_STATUS_CHANGED',
  'TICKET_RESOLVED'
);
CREATE TYPE "AutomationActionType" AS ENUM (
  'CREATE_TASK',
  'UPDATE_TASK',
  'ASSIGN_TASK',
  'CHANGE_TASK_STATUS',
  'ADD_TASK_TAG',
  'UPDATE_PROJECT',
  'CHANGE_PROJECT_STATUS',
  'ASSIGN_TICKET',
  'CHANGE_TICKET_STATUS',
  'ADD_TICKET_TAG'
);
CREATE TYPE "AutomationConditionOperator" AS ENUM (
  'EQUALS',
  'NOT_EQUALS',
  'IN',
  'NOT_IN',
  'EXISTS',
  'NOT_EXISTS'
);

CREATE TABLE "automation_workflows" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "status" "AutomationWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
  "active_published_version_id" UUID,
  "created_by_membership_id" UUID NOT NULL,
  "updated_by_membership_id" UUID,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "automation_workflows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_workflows_id_workspace_id_key" UNIQUE ("id", "workspace_id")
);

CREATE TABLE "automation_workflow_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workflow_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "version_number" INTEGER,
  "state" "AutomationWorkflowVersionState" NOT NULL DEFAULT 'DRAFT',
  "definition_version" VARCHAR(20) NOT NULL DEFAULT '1',
  "trigger_definition" JSONB NOT NULL,
  "nodes_definition" JSONB NOT NULL,
  "edges_definition" JSONB NOT NULL,
  "settings_definition" JSONB NOT NULL,
  "definition_size_bytes" INTEGER NOT NULL DEFAULT 0,
  "created_by_membership_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMPTZ(6),

  CONSTRAINT "automation_workflow_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_workflow_versions_id_workspace_id_key" UNIQUE ("id", "workspace_id"),
  CONSTRAINT "automation_workflow_versions_workflow_id_version_number_key" UNIQUE ("workflow_id", "version_number")
);

CREATE INDEX "automation_workflows_workspace_id_status_created_at_idx"
  ON "automation_workflows"("workspace_id", "status", "created_at");
CREATE INDEX "automation_workflows_workspace_id_archived_at_idx"
  ON "automation_workflows"("workspace_id", "archived_at");
CREATE INDEX "automation_workflows_workspace_id_active_published_version_id_idx"
  ON "automation_workflows"("workspace_id", "active_published_version_id");
CREATE INDEX "automation_workflow_versions_workflow_id_state_idx"
  ON "automation_workflow_versions"("workflow_id", "state");
CREATE INDEX "automation_workflow_versions_workspace_id_created_at_idx"
  ON "automation_workflow_versions"("workspace_id", "created_at");

CREATE UNIQUE INDEX "automation_workflow_versions_one_draft_per_workflow_idx"
  ON "automation_workflow_versions"("workflow_id")
  WHERE "state" = 'DRAFT';

ALTER TABLE "automation_workflows"
  ADD CONSTRAINT "automation_workflows_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_workflows_created_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_workflows_updated_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("updated_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_workflow_versions"
  ADD CONSTRAINT "automation_workflow_versions_workflow_id_workspace_id_fkey"
  FOREIGN KEY ("workflow_id", "workspace_id") REFERENCES "automation_workflows"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_workflow_versions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_workflow_versions_created_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_workflows"
  ADD CONSTRAINT "automation_workflows_active_published_version_id_workspace_id_fkey"
  FOREIGN KEY ("active_published_version_id", "workspace_id") REFERENCES "automation_workflow_versions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_published_automation_version_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."state" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published automation workflow versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "automation_workflow_versions_no_published_update"
BEFORE UPDATE ON "automation_workflow_versions"
FOR EACH ROW
EXECUTE FUNCTION prevent_published_automation_version_mutation();

CREATE OR REPLACE FUNCTION prevent_published_automation_version_delete()
RETURNS trigger AS $$
BEGIN
  IF OLD."state" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'Published automation workflow versions cannot be deleted';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "automation_workflow_versions_no_published_delete"
BEFORE DELETE ON "automation_workflow_versions"
FOR EACH ROW
EXECUTE FUNCTION prevent_published_automation_version_delete();

INSERT INTO "permissions" ("key", "description")
VALUES
  ('automation.view', 'automation.view permission'),
  ('automation.create', 'automation.create permission'),
  ('automation.edit', 'automation.edit permission'),
  ('automation.publish', 'automation.publish permission'),
  ('automation.disable', 'automation.disable permission')
ON CONFLICT ("key") DO NOTHING;
