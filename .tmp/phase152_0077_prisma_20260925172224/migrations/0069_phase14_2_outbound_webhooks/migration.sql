CREATE TYPE "WebhookSubscriptionStatus" AS ENUM ('ACTIVE', 'DISABLED');

CREATE TYPE "WebhookDeliveryStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'SUCCEEDED',
  'RETRY_SCHEDULED',
  'FAILED',
  'DEAD_LETTERED'
);

CREATE TABLE "webhook_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "endpoint_url" VARCHAR(2048) NOT NULL,
  "status" "WebhookSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "encrypted_secret" TEXT NOT NULL,
  "event_types" TEXT[] NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "last_success_at" TIMESTAMPTZ(6),
  "last_failure_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "event_version" INTEGER NOT NULL DEFAULT 1,
  "aggregate_type" VARCHAR(80) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "payload_json" JSONB NOT NULL,
  "correlation_id" VARCHAR(120),
  "causation_id" UUID,
  "is_test" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "webhook_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6),
  "processing_until" TIMESTAMPTZ(6),
  "last_attempt_at" TIMESTAMPTZ(6),
  "delivered_at" TIMESTAMPTZ(6),
  "http_status" INTEGER,
  "safe_error_code" VARCHAR(120),
  "response_duration_ms" INTEGER,
  "response_snippet" VARCHAR(4096),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "webhook_subscriptions_id_workspace_id_key" ON "webhook_subscriptions"("id", "workspace_id");
CREATE INDEX "webhook_subscriptions_workspace_id_status_created_at_idx" ON "webhook_subscriptions"("workspace_id", "status", "created_at");

CREATE UNIQUE INDEX "webhook_events_id_workspace_id_key" ON "webhook_events"("id", "workspace_id");
CREATE INDEX "webhook_events_workspace_id_event_type_created_at_idx" ON "webhook_events"("workspace_id", "event_type", "created_at");
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at");

CREATE UNIQUE INDEX "webhook_deliveries_event_id_subscription_id_key" ON "webhook_deliveries"("event_id", "subscription_id");
CREATE INDEX "webhook_deliveries_workspace_id_status_created_at_idx" ON "webhook_deliveries"("workspace_id", "status", "created_at");
CREATE INDEX "webhook_deliveries_status_next_attempt_at_id_idx" ON "webhook_deliveries"("status", "next_attempt_at", "id");
CREATE INDEX "webhook_deliveries_status_processing_until_id_idx" ON "webhook_deliveries"("status", "processing_until", "id");
CREATE INDEX "webhook_deliveries_workspace_id_subscription_id_created_at_idx" ON "webhook_deliveries"("workspace_id", "subscription_id", "created_at");
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries"("created_at");

ALTER TABLE "webhook_subscriptions"
  ADD CONSTRAINT "webhook_subscriptions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "webhook_subscriptions"
  ADD CONSTRAINT "webhook_subscriptions_created_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "webhook_events"
  ADD CONSTRAINT "webhook_events_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_event_id_workspace_id_fkey"
  FOREIGN KEY ("event_id", "workspace_id") REFERENCES "webhook_events"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "webhook_deliveries"
  ADD CONSTRAINT "webhook_deliveries_subscription_id_workspace_id_fkey"
  FOREIGN KEY ("subscription_id", "workspace_id") REFERENCES "webhook_subscriptions"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
