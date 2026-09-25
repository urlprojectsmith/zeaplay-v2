-- Phase 11.2 Trigger engine and trusted domain events.

CREATE TYPE "AutomationDomainEventEntityType" AS ENUM ('TASK', 'PROJECT', 'TICKET');
CREATE TYPE "AutomationTriggerMatchStatus" AS ENUM ('MATCHED', 'SKIPPED', 'INVALID');

CREATE TABLE "automation_domain_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "event_type" "AutomationTriggerType" NOT NULL,
  "entity_type" "AutomationDomainEventEntityType" NOT NULL,
  "entity_id" UUID NOT NULL,
  "actor_membership_id" UUID,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "correlation_id" VARCHAR(120) NOT NULL,
  "causation_id" UUID,
  "automation_depth" INTEGER NOT NULL DEFAULT 0,
  "payload" JSONB NOT NULL,
  "idempotency_key" VARCHAR(240) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "automation_domain_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_domain_events_workspace_id_idempotency_key_key" UNIQUE ("workspace_id", "idempotency_key"),
  CONSTRAINT "automation_domain_events_id_workspace_id_key" UNIQUE ("id", "workspace_id")
);

CREATE TABLE "automation_trigger_matches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "domain_event_id" UUID NOT NULL,
  "workflow_id" UUID NOT NULL,
  "workflow_version_id" UUID NOT NULL,
  "trigger_node_id" VARCHAR(80) NOT NULL,
  "status" "AutomationTriggerMatchStatus" NOT NULL DEFAULT 'MATCHED',
  "reason_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "automation_trigger_matches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "automation_trigger_matches_domain_event_id_workflow_version_id_trigger_node_id_key"
    UNIQUE ("domain_event_id", "workflow_version_id", "trigger_node_id")
);

CREATE INDEX "automation_domain_events_workspace_id_occurred_at_idx"
  ON "automation_domain_events"("workspace_id", "occurred_at");
CREATE INDEX "automation_domain_events_workspace_id_event_type_occurred_at_idx"
  ON "automation_domain_events"("workspace_id", "event_type", "occurred_at");
CREATE INDEX "automation_domain_events_entity_type_entity_id_occurred_at_idx"
  ON "automation_domain_events"("entity_type", "entity_id", "occurred_at");

CREATE INDEX "automation_trigger_matches_workspace_id_created_at_idx"
  ON "automation_trigger_matches"("workspace_id", "created_at");
CREATE INDEX "automation_trigger_matches_domain_event_id_idx"
  ON "automation_trigger_matches"("domain_event_id");
CREATE INDEX "automation_trigger_matches_workflow_version_id_idx"
  ON "automation_trigger_matches"("workflow_version_id");

ALTER TABLE "automation_domain_events"
  ADD CONSTRAINT "automation_domain_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_domain_events_actor_membership_id_workspace_id_fkey"
  FOREIGN KEY ("actor_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "automation_trigger_matches"
  ADD CONSTRAINT "automation_trigger_matches_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_trigger_matches_domain_event_id_workspace_id_fkey"
  FOREIGN KEY ("domain_event_id", "workspace_id") REFERENCES "automation_domain_events"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_trigger_matches_workflow_id_workspace_id_fkey"
  FOREIGN KEY ("workflow_id", "workspace_id") REFERENCES "automation_workflows"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "automation_trigger_matches_workflow_version_id_workspace_id_fkey"
  FOREIGN KEY ("workflow_version_id", "workspace_id") REFERENCES "automation_workflow_versions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_automation_domain_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Automation domain events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "automation_domain_events_no_update"
BEFORE UPDATE ON "automation_domain_events"
FOR EACH ROW
EXECUTE FUNCTION prevent_automation_domain_event_mutation();

CREATE TRIGGER "automation_domain_events_no_delete"
BEFORE DELETE ON "automation_domain_events"
FOR EACH ROW
EXECUTE FUNCTION prevent_automation_domain_event_mutation();

CREATE OR REPLACE FUNCTION prevent_automation_trigger_match_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Automation trigger matches are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "automation_trigger_matches_no_update"
BEFORE UPDATE ON "automation_trigger_matches"
FOR EACH ROW
EXECUTE FUNCTION prevent_automation_trigger_match_mutation();

CREATE TRIGGER "automation_trigger_matches_no_delete"
BEFORE DELETE ON "automation_trigger_matches"
FOR EACH ROW
EXECUTE FUNCTION prevent_automation_trigger_match_mutation();
