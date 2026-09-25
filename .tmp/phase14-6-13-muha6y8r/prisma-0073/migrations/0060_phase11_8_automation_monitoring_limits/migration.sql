CREATE TABLE "automation_workspace_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "max_published_workflows" INTEGER NOT NULL,
  "max_executions_per_minute" INTEGER NOT NULL,
  "max_concurrent_executions" INTEGER NOT NULL,
  "max_actions_per_execution" INTEGER NOT NULL,
  "max_replays_per_hour" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "automation_workspace_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_workspace_policies_workspace_id_key" UNIQUE ("workspace_id"),
  CONSTRAINT "automation_workspace_policies_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

DROP INDEX "automation_executions_trigger_match_id_key";
DROP INDEX "automation_executions_trigger_match_id_workspace_id_key";
CREATE INDEX "automation_executions_trigger_match_id_workspace_id_idx"
  ON "automation_executions"("trigger_match_id", "workspace_id");

ALTER TABLE "automation_executions"
  ADD COLUMN "replay_of_execution_id" UUID,
  ADD COLUMN "replay_reason" VARCHAR(500),
  ADD COLUMN "replay_idempotency_key" VARCHAR(120);

ALTER TABLE "automation_executions"
  ADD CONSTRAINT "automation_executions_workflow_id_workspace_id_fkey"
    FOREIGN KEY ("workflow_id", "workspace_id")
    REFERENCES "automation_workflows"("id", "workspace_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_executions_replay_of_execution_id_workspace_id_fkey"
    FOREIGN KEY ("replay_of_execution_id", "workspace_id")
    REFERENCES "automation_executions"("id", "workspace_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "automation_executions_workspace_id_replay_idempotency_key_key"
  ON "automation_executions"("workspace_id", "replay_idempotency_key")
  WHERE "replay_idempotency_key" IS NOT NULL;

CREATE INDEX "automation_executions_workspace_id_replay_of_execution_id_idx"
  ON "automation_executions"("workspace_id", "replay_of_execution_id");

CREATE INDEX "automation_executions_workspace_id_correlation_id_idx"
  ON "automation_executions"("workspace_id", "correlation_id");
