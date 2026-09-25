-- Phase 11.9 audit hardening:
-- keep replay executions allowed while restoring the runtime invariant that a
-- TriggerMatch can create at most one non-replay AutomationExecution.

CREATE UNIQUE INDEX "automation_executions_trigger_match_id_non_replay_key"
  ON "automation_executions"("trigger_match_id")
  WHERE "replay_of_execution_id" IS NULL;
