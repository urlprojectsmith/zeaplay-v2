CREATE TYPE "InboundWebhookSourceType" AS ENUM ('GENERIC_HMAC_V1');

CREATE TYPE "InboundWebhookSourceStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TYPE "InboundWebhookEventStatus" AS ENUM (
  'VERIFIED',
  'NORMALIZED',
  'FAILED_NORMALIZATION'
);

CREATE TABLE "inbound_webhook_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "public_identifier" VARCHAR(64) NOT NULL,
  "type" "InboundWebhookSourceType" NOT NULL DEFAULT 'GENERIC_HMAC_V1',
  "status" "InboundWebhookSourceStatus" NOT NULL DEFAULT 'ACTIVE',
  "encrypted_signing_secret" TEXT NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "last_received_at" TIMESTAMPTZ(6),
  "last_verified_at" TIMESTAMPTZ(6),
  "last_failure_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inbound_webhook_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inbound_webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "external_event_id" VARCHAR(200) NOT NULL,
  "raw_body_hash" VARCHAR(64) NOT NULL,
  "event_type" VARCHAR(150),
  "event_version" VARCHAR(20),
  "status" "InboundWebhookEventStatus" NOT NULL DEFAULT 'VERIFIED',
  "normalized_type" VARCHAR(150),
  "normalized_payload_json" JSONB,
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "verified_at" TIMESTAMPTZ(6) NOT NULL,
  "normalized_at" TIMESTAMPTZ(6),
  "safe_error_code" VARCHAR(120),
  "correlation_id" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inbound_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "normalized_inbound_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "inbound_event_id" UUID NOT NULL,
  "source_type" "InboundWebhookSourceType" NOT NULL,
  "external_event_id" VARCHAR(200) NOT NULL,
  "type" VARCHAR(150) NOT NULL,
  "version" VARCHAR(20) NOT NULL,
  "occurred_at" TIMESTAMPTZ(6),
  "received_at" TIMESTAMPTZ(6) NOT NULL,
  "data" JSONB NOT NULL,
  "correlation_id" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "normalized_inbound_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inbound_webhook_sources_id_workspace_id_key"
  ON "inbound_webhook_sources"("id", "workspace_id");

CREATE UNIQUE INDEX "inbound_webhook_sources_public_identifier_key"
  ON "inbound_webhook_sources"("public_identifier");

CREATE INDEX "inbound_webhook_sources_workspace_id_status_created_at_idx"
  ON "inbound_webhook_sources"("workspace_id", "status", "created_at");

CREATE INDEX "inbound_webhook_sources_workspace_id_created_at_idx"
  ON "inbound_webhook_sources"("workspace_id", "created_at");

CREATE UNIQUE INDEX "inbound_webhook_events_id_workspace_id_key"
  ON "inbound_webhook_events"("id", "workspace_id");

CREATE UNIQUE INDEX "inbound_webhook_events_source_id_external_event_id_key"
  ON "inbound_webhook_events"("source_id", "external_event_id");

CREATE INDEX "inbound_webhook_events_workspace_id_received_at_idx"
  ON "inbound_webhook_events"("workspace_id", "received_at");

CREATE INDEX "inbound_webhook_events_source_id_received_at_idx"
  ON "inbound_webhook_events"("source_id", "received_at");

CREATE INDEX "inbound_webhook_events_status_received_at_idx"
  ON "inbound_webhook_events"("status", "received_at");

CREATE INDEX "inbound_webhook_events_received_at_idx"
  ON "inbound_webhook_events"("received_at");

CREATE UNIQUE INDEX "normalized_inbound_events_inbound_event_id_key"
  ON "normalized_inbound_events"("inbound_event_id");

CREATE UNIQUE INDEX "normalized_inbound_events_inbound_event_id_workspace_id_key"
  ON "normalized_inbound_events"("inbound_event_id", "workspace_id");

CREATE INDEX "normalized_inbound_events_workspace_id_received_at_idx"
  ON "normalized_inbound_events"("workspace_id", "received_at");

CREATE INDEX "normalized_inbound_events_source_id_received_at_idx"
  ON "normalized_inbound_events"("source_id", "received_at");

CREATE INDEX "normalized_inbound_events_type_received_at_idx"
  ON "normalized_inbound_events"("type", "received_at");

ALTER TABLE "inbound_webhook_sources"
  ADD CONSTRAINT "inbound_webhook_sources_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbound_webhook_sources"
  ADD CONSTRAINT "inbound_webhook_sources_created_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("created_by_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbound_webhook_events"
  ADD CONSTRAINT "inbound_webhook_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inbound_webhook_events"
  ADD CONSTRAINT "inbound_webhook_events_source_id_workspace_id_fkey"
  FOREIGN KEY ("source_id", "workspace_id")
  REFERENCES "inbound_webhook_sources"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "normalized_inbound_events"
  ADD CONSTRAINT "normalized_inbound_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "normalized_inbound_events"
  ADD CONSTRAINT "normalized_inbound_events_source_id_workspace_id_fkey"
  FOREIGN KEY ("source_id", "workspace_id")
  REFERENCES "inbound_webhook_sources"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "normalized_inbound_events"
  ADD CONSTRAINT "normalized_inbound_events_inbound_event_id_workspace_id_fkey"
  FOREIGN KEY ("inbound_event_id", "workspace_id")
  REFERENCES "inbound_webhook_events"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
