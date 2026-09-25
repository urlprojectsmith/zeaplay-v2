-- Phase 11.5: allow non-action automation steps and persist deterministic branch decisions.

ALTER TABLE "automation_step_executions"
  ADD COLUMN "node_type" "AutomationWorkflowNodeType" NOT NULL DEFAULT 'ACTION',
  ALTER COLUMN "action_type" DROP NOT NULL,
  ADD COLUMN "selected_branch_key" VARCHAR(80),
  ADD COLUMN "condition_result" BOOLEAN;

ALTER TABLE "automation_step_executions"
  ADD CONSTRAINT "automation_step_executions_action_type_for_action_check"
  CHECK (
    ("node_type" = 'ACTION' AND "action_type" IS NOT NULL)
    OR ("node_type" <> 'ACTION' AND "action_type" IS NULL)
  );
