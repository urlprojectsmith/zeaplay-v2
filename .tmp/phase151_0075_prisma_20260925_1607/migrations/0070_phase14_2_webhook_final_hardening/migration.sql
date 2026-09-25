ALTER TABLE "webhook_events"
  ADD COLUMN "source_automation_domain_event_id" UUID;

CREATE UNIQUE INDEX "webhook_events_workspace_id_source_automation_domain_event_id_key"
  ON "webhook_events"("workspace_id", "source_automation_domain_event_id");
