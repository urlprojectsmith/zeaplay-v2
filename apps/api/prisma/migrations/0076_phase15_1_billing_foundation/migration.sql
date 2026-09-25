-- Phase 15.1: Billing foundation, master plans, immutable plan versions, and
-- Super Agency subscription foundations. This migration is additive and does
-- not create Agency, Workspace, or Organization billing ownership.

CREATE TYPE "MasterPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "PlanVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "PlanEntitlementKind" AS ENUM ('FEATURE', 'LIMIT');
CREATE TYPE "PlanEntitlementValueType" AS ENUM ('BOOLEAN', 'INTEGER', 'BYTES', 'COUNT', 'UNLIMITED');
CREATE TYPE "SuperAgencySubscriptionStatus" AS ENUM (
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELED',
  'EXPIRED'
);

CREATE TABLE "master_plans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(80) NOT NULL,
  "display_name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(500),
  "status" "MasterPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "master_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "master_plans_key_format_chk" CHECK ("key" ~ '^[a-z0-9][a-z0-9_.-]{1,79}$')
);

CREATE TABLE "master_plan_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "master_plan_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "status" "PlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "published_at" TIMESTAMPTZ(6),
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "master_plan_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "master_plan_versions_version_positive_chk" CHECK ("version_number" > 0),
  CONSTRAINT "master_plan_versions_published_at_chk" CHECK (
    ("status" <> 'PUBLISHED' AND "published_at" IS NULL)
    OR ("status" = 'PUBLISHED' AND "published_at" IS NOT NULL)
  )
);

CREATE TABLE "plan_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "plan_version_id" UUID NOT NULL,
  "key" VARCHAR(120) NOT NULL,
  "kind" "PlanEntitlementKind" NOT NULL,
  "value_type" "PlanEntitlementValueType" NOT NULL,
  "boolean_value" BOOLEAN,
  "numeric_value" BIGINT,
  "unlimited" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "plan_entitlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_entitlements_key_format_chk" CHECK ("key" ~ '^[a-z][a-z0-9_.-]{1,119}$'),
  CONSTRAINT "plan_entitlements_boolean_shape_chk" CHECK (
    ("value_type" = 'BOOLEAN' AND "kind" = 'FEATURE' AND "boolean_value" IS NOT NULL AND "numeric_value" IS NULL AND "unlimited" = false)
    OR ("value_type" <> 'BOOLEAN')
  ),
  CONSTRAINT "plan_entitlements_numeric_shape_chk" CHECK (
    ("value_type" IN ('INTEGER', 'BYTES', 'COUNT') AND "kind" = 'LIMIT' AND "boolean_value" IS NULL AND "numeric_value" IS NOT NULL AND "numeric_value" >= 0 AND "unlimited" = false)
    OR ("value_type" NOT IN ('INTEGER', 'BYTES', 'COUNT'))
  ),
  CONSTRAINT "plan_entitlements_unlimited_shape_chk" CHECK (
    ("value_type" = 'UNLIMITED' AND "kind" = 'LIMIT' AND "boolean_value" IS NULL AND "numeric_value" IS NULL AND "unlimited" = true)
    OR ("value_type" <> 'UNLIMITED')
  )
);

CREATE TABLE "super_agency_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "super_agency_id" UUID NOT NULL,
  "master_plan_id" UUID NOT NULL,
  "plan_version_id" UUID NOT NULL,
  "status" "SuperAgencySubscriptionStatus" NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "trial_started_at" TIMESTAMPTZ(6),
  "trial_ends_at" TIMESTAMPTZ(6),
  "started_at" TIMESTAMPTZ(6),
  "ended_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "super_agency_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "super_agency_subscriptions_trial_window_chk" CHECK (
    "trial_started_at" IS NULL
    OR ("trial_ends_at" IS NOT NULL AND "trial_ends_at" > "trial_started_at")
  )
);

CREATE UNIQUE INDEX "master_plans_key_key" ON "master_plans"("key");
CREATE INDEX "master_plans_status_created_at_idx" ON "master_plans"("status", "created_at");

CREATE UNIQUE INDEX "master_plan_versions_master_plan_id_version_number_key"
  ON "master_plan_versions"("master_plan_id", "version_number");
CREATE INDEX "master_plan_versions_master_plan_id_status_idx"
  ON "master_plan_versions"("master_plan_id", "status");
CREATE UNIQUE INDEX "master_plan_versions_one_draft_per_plan_key"
  ON "master_plan_versions"("master_plan_id")
  WHERE "status" = 'DRAFT';

CREATE UNIQUE INDEX "plan_entitlements_plan_version_id_key_key"
  ON "plan_entitlements"("plan_version_id", "key");
CREATE INDEX "plan_entitlements_kind_key_idx" ON "plan_entitlements"("kind", "key");

CREATE INDEX "super_agency_subscriptions_super_agency_id_is_current_idx"
  ON "super_agency_subscriptions"("super_agency_id", "is_current");
CREATE UNIQUE INDEX "super_agency_subscriptions_one_current_per_super_agency_key"
  ON "super_agency_subscriptions"("super_agency_id")
  WHERE "is_current" = true;
CREATE INDEX "super_agency_subscriptions_plan_version_id_idx"
  ON "super_agency_subscriptions"("plan_version_id");
CREATE INDEX "super_agency_subscriptions_status_idx"
  ON "super_agency_subscriptions"("status");

ALTER TABLE "master_plan_versions"
  ADD CONSTRAINT "master_plan_versions_master_plan_id_fkey"
  FOREIGN KEY ("master_plan_id") REFERENCES "master_plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "plan_entitlements"
  ADD CONSTRAINT "plan_entitlements_plan_version_id_fkey"
  FOREIGN KEY ("plan_version_id") REFERENCES "master_plan_versions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "super_agency_subscriptions"
  ADD CONSTRAINT "super_agency_subscriptions_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "super_agency_subscriptions"
  ADD CONSTRAINT "super_agency_subscriptions_master_plan_id_fkey"
  FOREIGN KEY ("master_plan_id") REFERENCES "master_plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "super_agency_subscriptions"
  ADD CONSTRAINT "super_agency_subscriptions_plan_version_id_fkey"
  FOREIGN KEY ("plan_version_id") REFERENCES "master_plan_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
