-- Phase 15.3 hierarchical allocation, usage metering, and enforcement.
-- Additive only: existing tenants remain compatible and no allocations are backfilled.

ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'ALLOCATION_UPDATED';

CREATE TYPE "BillingResourceDimension" AS ENUM ('LIVE_CAPACITY', 'PERIOD_METERED', 'FEATURE_ONLY');
CREATE TYPE "BillingUsageScope" AS ENUM ('SUPER_AGENCY', 'AGENCY', 'WORKSPACE');

CREATE TABLE "agency_resource_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agency_id" UUID NOT NULL,
    "resource_key" VARCHAR(80) NOT NULL,
    "allocated" BIGINT,
    "unlimited" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "agency_resource_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agency_resource_allocations_allocated_non_negative"
        CHECK ("allocated" IS NULL OR "allocated" >= 0),
    CONSTRAINT "agency_resource_allocations_value_shape"
        CHECK (("unlimited" = true AND "allocated" IS NULL) OR ("unlimited" = false AND "allocated" IS NOT NULL))
);

CREATE TABLE "workspace_resource_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "resource_key" VARCHAR(80) NOT NULL,
    "allocated" BIGINT,
    "unlimited" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_resource_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_resource_allocations_allocated_non_negative"
        CHECK ("allocated" IS NULL OR "allocated" >= 0),
    CONSTRAINT "workspace_resource_allocations_value_shape"
        CHECK (("unlimited" = true AND "allocated" IS NULL) OR ("unlimited" = false AND "allocated" IS NOT NULL))
);

CREATE TABLE "billing_usage_counters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" "BillingUsageScope" NOT NULL,
    "scope_id" UUID NOT NULL,
    "resource_key" VARCHAR(80) NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "used" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_usage_counters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "billing_usage_counters_used_non_negative" CHECK ("used" >= 0),
    CONSTRAINT "billing_usage_counters_period_order" CHECK ("period_end" > "period_start")
);

CREATE UNIQUE INDEX "agency_resource_allocations_agency_id_resource_key_key"
    ON "agency_resource_allocations"("agency_id", "resource_key");
CREATE INDEX "agency_resource_allocations_resource_key_idx"
    ON "agency_resource_allocations"("resource_key");

CREATE UNIQUE INDEX "workspace_resource_allocations_workspace_id_resource_key_key"
    ON "workspace_resource_allocations"("workspace_id", "resource_key");
CREATE INDEX "workspace_resource_allocations_resource_key_idx"
    ON "workspace_resource_allocations"("resource_key");

CREATE UNIQUE INDEX "billing_usage_counters_scope_scope_id_resource_key_period_start_key"
    ON "billing_usage_counters"("scope", "scope_id", "resource_key", "period_start");
CREATE INDEX "billing_usage_counters_scope_scope_id_resource_key_period_end_idx"
    ON "billing_usage_counters"("scope", "scope_id", "resource_key", "period_end");

ALTER TABLE "agency_resource_allocations"
    ADD CONSTRAINT "agency_resource_allocations_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_resource_allocations"
    ADD CONSTRAINT "workspace_resource_allocations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
