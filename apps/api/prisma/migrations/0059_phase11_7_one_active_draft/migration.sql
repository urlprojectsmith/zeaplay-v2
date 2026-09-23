CREATE UNIQUE INDEX "automation_workflow_versions_one_draft_idx"
    ON "automation_workflow_versions"("workspace_id", "workflow_id")
    WHERE "state" = 'DRAFT';

