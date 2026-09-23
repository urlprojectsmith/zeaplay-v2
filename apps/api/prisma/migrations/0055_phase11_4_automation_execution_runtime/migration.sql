-- Phase 11.4 durable automation execution runtime.
-- Existing trigger matches intentionally remain runtime_eligible_at = NULL.

CREATE TYPE "AutomationExecutionStatus" AS ENUM (
  'PENDING_QUEUE',
  'QUEUED',
  'RUNNING',
  'RETRYING',
  'SUCCEEDED',
  'FAILED',
  'DEAD_LETTERED',
  'BLOCKED'
);

CREATE TYPE "AutomationStepExecutionStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'RETRYING',
  'SUCCEEDED',
  'NO_OP',
  'FAILED',
  'SKIPPED'
);

ALTER TABLE "automation_trigger_matches"
  ADD COLUMN "runtime_eligible_at" TIMESTAMPTZ(6);

CREATE TABLE "automation_executions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "trigger_match_id" UUID NOT NULL,
  "domain_event_id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "workflow_version_id" UUID NOT NULL,
  "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'PENDING_QUEUE',
  "correlation_id" VARCHAR(120) NOT NULL,
  "automation_depth" INTEGER NOT NULL DEFAULT 0,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "failure_code" VARCHAR(120),
  "failure_message" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "queued_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),

  CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_executions_max_attempts_check" CHECK ("max_attempts" BETWEEN 1 AND 10),
  CONSTRAINT "automation_executions_automation_depth_check" CHECK ("automation_depth" >= 0)
);

CREATE TABLE "automation_step_executions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "execution_id" UUID NOT NULL,
  "workflow_version_id" UUID NOT NULL,
  "node_id" VARCHAR(80) NOT NULL,
  "sequence" INTEGER NOT NULL,
  "action_type" "AutomationActionType" NOT NULL,
  "status" "AutomationStepExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "invocation_key" VARCHAR(180) NOT NULL,
  "result" JSONB,
  "error_code" VARCHAR(120),
  "error_message" VARCHAR(500),
  "started_at" TIMESTAMPTZ(6),
  "finished_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "automation_step_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_step_executions_sequence_check" CHECK ("sequence" >= 1),
  CONSTRAINT "automation_step_executions_attempt_count_check" CHECK ("attempt_count" >= 0)
);

CREATE UNIQUE INDEX "automation_executions_id_workspace_id_key"
  ON "automation_executions"("id", "workspace_id");
CREATE UNIQUE INDEX "automation_executions_trigger_match_id_key"
  ON "automation_executions"("trigger_match_id");
CREATE UNIQUE INDEX "automation_executions_trigger_match_id_workspace_id_key"
  ON "automation_executions"("trigger_match_id", "workspace_id");
CREATE INDEX "automation_executions_workspace_id_created_at_idx"
  ON "automation_executions"("workspace_id", "created_at");
CREATE INDEX "automation_executions_workspace_id_status_created_at_idx"
  ON "automation_executions"("workspace_id", "status", "created_at");
CREATE INDEX "automation_executions_status_created_at_idx"
  ON "automation_executions"("status", "created_at");
CREATE INDEX "automation_executions_domain_event_id_idx"
  ON "automation_executions"("domain_event_id");
CREATE INDEX "automation_executions_workflow_version_id_idx"
  ON "automation_executions"("workflow_version_id");

CREATE UNIQUE INDEX "automation_step_executions_invocation_key_key"
  ON "automation_step_executions"("invocation_key");
CREATE UNIQUE INDEX "automation_step_executions_execution_id_node_id_key"
  ON "automation_step_executions"("execution_id", "node_id");
CREATE INDEX "automation_step_executions_execution_id_sequence_idx"
  ON "automation_step_executions"("execution_id", "sequence");
CREATE INDEX "automation_step_executions_execution_id_status_idx"
  ON "automation_step_executions"("execution_id", "status");
CREATE INDEX "automation_step_executions_workspace_id_execution_id_idx"
  ON "automation_step_executions"("workspace_id", "execution_id");
CREATE INDEX "automation_trigger_matches_workspace_id_runtime_eligible_at_idx"
  ON "automation_trigger_matches"("workspace_id", "runtime_eligible_at");
CREATE UNIQUE INDEX "automation_trigger_matches_id_workspace_id_key"
  ON "automation_trigger_matches"("id", "workspace_id");

ALTER TABLE "automation_executions"
  ADD CONSTRAINT "automation_executions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_executions"
  ADD CONSTRAINT "automation_executions_trigger_match_id_workspace_id_fkey"
  FOREIGN KEY ("trigger_match_id", "workspace_id") REFERENCES "automation_trigger_matches"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_executions"
  ADD CONSTRAINT "automation_executions_domain_event_id_workspace_id_fkey"
  FOREIGN KEY ("domain_event_id", "workspace_id") REFERENCES "automation_domain_events"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_executions"
  ADD CONSTRAINT "automation_executions_workflow_version_id_workspace_id_fkey"
  FOREIGN KEY ("workflow_version_id", "workspace_id") REFERENCES "automation_workflow_versions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_step_executions"
  ADD CONSTRAINT "automation_step_executions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_step_executions"
  ADD CONSTRAINT "automation_step_executions_execution_id_workspace_id_fkey"
  FOREIGN KEY ("execution_id", "workspace_id") REFERENCES "automation_executions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "automation_step_executions"
  ADD CONSTRAINT "automation_step_executions_workflow_version_id_workspace_id_fkey"
  FOREIGN KEY ("workflow_version_id", "workspace_id") REFERENCES "automation_workflow_versions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
