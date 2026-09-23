-- Phase 11.4 refinement: durable CREATE_TASK idempotency per automation step invocation.

ALTER TABLE "tasks"
  ADD COLUMN "automation_invocation_key" VARCHAR(180);

CREATE INDEX "tasks_workspace_id_automation_invocation_key_idx"
  ON "tasks"("workspace_id", "automation_invocation_key");

CREATE UNIQUE INDEX "tasks_workspace_id_automation_invocation_key_key"
  ON "tasks"("workspace_id", "automation_invocation_key")
  WHERE "automation_invocation_key" IS NOT NULL;
