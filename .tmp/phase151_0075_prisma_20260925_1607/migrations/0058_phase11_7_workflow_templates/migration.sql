CREATE TABLE "automation_workflow_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "definition_version" VARCHAR(20) NOT NULL DEFAULT '1',
    "trigger_definition" JSONB NOT NULL,
    "nodes_definition" JSONB NOT NULL,
    "edges_definition" JSONB NOT NULL,
    "settings_definition" JSONB NOT NULL,
    "definition_size_bytes" INTEGER NOT NULL DEFAULT 0,
    "source_workflow_id" UUID,
    "source_workflow_version_id" UUID,
    "created_by_membership_id" UUID NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_workflow_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_workflow_templates_id_workspace_id_key"
    ON "automation_workflow_templates"("id", "workspace_id");

CREATE INDEX "automation_templates_workspace_archive_updated_idx"
    ON "automation_workflow_templates"("workspace_id", "archived_at", "updated_at");

CREATE INDEX "automation_templates_workspace_source_workflow_idx"
    ON "automation_workflow_templates"("workspace_id", "source_workflow_id");

CREATE INDEX "automation_templates_workspace_source_version_idx"
    ON "automation_workflow_templates"("workspace_id", "source_workflow_version_id");

ALTER TABLE "automation_workflow_templates"
    ADD CONSTRAINT "automation_workflow_templates_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_workflow_templates"
    ADD CONSTRAINT "automation_workflow_templates_source_workflow_id_workspace_id_fkey"
    FOREIGN KEY ("source_workflow_id", "workspace_id") REFERENCES "automation_workflows"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_workflow_templates"
    ADD CONSTRAINT "automation_workflow_templates_source_workflow_version_id_workspace_id_fkey"
    FOREIGN KEY ("source_workflow_version_id", "workspace_id") REFERENCES "automation_workflow_versions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_workflow_templates"
    ADD CONSTRAINT "automation_workflow_templates_created_by_membership_id_workspace_id_fkey"
    FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
