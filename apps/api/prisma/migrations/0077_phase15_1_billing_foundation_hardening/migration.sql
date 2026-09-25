-- Phase 15.1 reconciliation hardening. This forward-only migration preserves
-- 0076 and adds plan type, grace/restricted vocabulary, and immutable billing
-- history without adding Stripe lifecycle or Agency/Workspace subscriptions.

CREATE TYPE "MasterPlanType" AS ENUM (
  'PUBLIC',
  'PRIVATE',
  'ENTERPRISE',
  'INTERNAL',
  'FREE',
  'DEMO',
  'QA'
);

CREATE TYPE "BillingHistoryEventType" AS ENUM (
  'PLAN_CREATED',
  'PLAN_DRAFT_UPDATED',
  'PLAN_VERSION_CREATED',
  'PLAN_VERSION_PUBLISHED',
  'PLAN_VERSION_ARCHIVED',
  'PLAN_ARCHIVED',
  'PLAN_ASSIGNED',
  'TRIAL_STARTED'
);

ALTER TYPE "SuperAgencySubscriptionStatus" ADD VALUE IF NOT EXISTS 'GRACE_PERIOD';
ALTER TYPE "SuperAgencySubscriptionStatus" ADD VALUE IF NOT EXISTS 'RESTRICTED';

ALTER TABLE "master_plans"
  ADD COLUMN "type" "MasterPlanType" NOT NULL DEFAULT 'PUBLIC';

CREATE INDEX "master_plans_type_status_idx" ON "master_plans"("type", "status");

CREATE TABLE "billing_history" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "super_agency_id" UUID,
  "master_plan_id" UUID,
  "plan_version_id" UUID,
  "subscription_id" UUID,
  "event_type" "BillingHistoryEventType" NOT NULL,
  "actor_user_id" UUID,
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "billing_history_super_agency_id_created_at_idx"
  ON "billing_history"("super_agency_id", "created_at");
CREATE INDEX "billing_history_master_plan_id_created_at_idx"
  ON "billing_history"("master_plan_id", "created_at");
CREATE INDEX "billing_history_plan_version_id_created_at_idx"
  ON "billing_history"("plan_version_id", "created_at");
CREATE INDEX "billing_history_subscription_id_created_at_idx"
  ON "billing_history"("subscription_id", "created_at");
CREATE INDEX "billing_history_event_type_created_at_idx"
  ON "billing_history"("event_type", "created_at");

ALTER TABLE "billing_history"
  ADD CONSTRAINT "billing_history_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_history"
  ADD CONSTRAINT "billing_history_master_plan_id_fkey"
  FOREIGN KEY ("master_plan_id") REFERENCES "master_plans"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_history"
  ADD CONSTRAINT "billing_history_plan_version_id_fkey"
  FOREIGN KEY ("plan_version_id") REFERENCES "master_plan_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_history"
  ADD CONSTRAINT "billing_history_subscription_id_fkey"
  FOREIGN KEY ("subscription_id") REFERENCES "super_agency_subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_history"
  ADD CONSTRAINT "billing_history_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
