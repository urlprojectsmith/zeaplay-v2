-- Phase 15.2 Stripe + trial + subscription lifecycle foundation.
-- Additive only: no Stripe Customers are created, no trials are started, and
-- existing Super Agency/Agency/Workspace operational data is not rewritten.

CREATE TYPE "BillingProvider" AS ENUM ('STRIPE', 'INTERNAL');
CREATE TYPE "BillingInterval" AS ENUM ('MONTHLY', 'ANNUAL');
CREATE TYPE "BillingPriceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "BillingCheckoutAttemptStatus" AS ENUM (
  'OPEN',
  'COMPLETED',
  'CANCELED',
  'EXPIRED',
  'FAILED'
);
CREATE TYPE "StripeBillingEventStatus" AS ENUM (
  'RECEIVED',
  'PROCESSED',
  'IGNORED',
  'FAILED'
);

ALTER TYPE "SuperAgencySubscriptionStatus" ADD VALUE IF NOT EXISTS 'TRIAL_GRACE';
ALTER TYPE "SuperAgencySubscriptionStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_GRACE';

ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'TRIAL_GRACE_STARTED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'RESTRICTED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'CHECKOUT_STARTED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_FAILED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECOVERED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'UPGRADE_REQUESTED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'UPGRADE_COMPLETED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'DOWNGRADE_SCHEDULED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'DOWNGRADE_APPLIED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'CANCELLATION_REQUESTED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'CANCELED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'REACTIVATED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'PRICE_CREATED';
ALTER TYPE "BillingHistoryEventType" ADD VALUE IF NOT EXISTS 'PORTAL_SESSION_CREATED';

ALTER TABLE "master_plans"
  ADD COLUMN "tier_rank" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "external_product_id" VARCHAR(120);

CREATE UNIQUE INDEX "master_plans_external_product_id_key"
  ON "master_plans"("external_product_id")
  WHERE "external_product_id" IS NOT NULL;
CREATE INDEX "master_plans_tier_rank_idx" ON "master_plans"("tier_rank");

CREATE TABLE "billing_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "master_plan_id" UUID NOT NULL,
  "plan_version_id" UUID NOT NULL,
  "provider" "BillingProvider" NOT NULL DEFAULT 'STRIPE',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'USD',
  "interval" "BillingInterval" NOT NULL,
  "amount_minor" BIGINT NOT NULL,
  "external_product_id" VARCHAR(120),
  "external_price_id" VARCHAR(120),
  "status" "BillingPriceStatus" NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_prices_amount_minor_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "billing_prices_currency_check" CHECK ("currency" = upper("currency"))
);

CREATE UNIQUE INDEX "billing_prices_plan_version_id_provider_currency_interval_key"
  ON "billing_prices"("plan_version_id", "provider", "currency", "interval");
CREATE UNIQUE INDEX "billing_prices_external_price_id_key"
  ON "billing_prices"("external_price_id")
  WHERE "external_price_id" IS NOT NULL;
CREATE INDEX "billing_prices_master_plan_id_status_idx"
  ON "billing_prices"("master_plan_id", "status");
CREATE INDEX "billing_prices_provider_status_idx"
  ON "billing_prices"("provider", "status");
CREATE INDEX "billing_prices_currency_interval_idx"
  ON "billing_prices"("currency", "interval");

ALTER TABLE "billing_prices"
  ADD CONSTRAINT "billing_prices_master_plan_id_fkey"
  FOREIGN KEY ("master_plan_id") REFERENCES "master_plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_prices"
  ADD CONSTRAINT "billing_prices_plan_version_id_fkey"
  FOREIGN KEY ("plan_version_id") REFERENCES "master_plan_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "super_agency_subscriptions"
  ADD COLUMN "billing_price_id" UUID,
  ADD COLUMN "provider" "BillingProvider" NOT NULL DEFAULT 'INTERNAL',
  ADD COLUMN "billing_interval" "BillingInterval",
  ADD COLUMN "stripe_subscription_id" VARCHAR(120),
  ADD COLUMN "stripe_subscription_item_id" VARCHAR(120),
  ADD COLUMN "provider_status" VARCHAR(80),
  ADD COLUMN "current_period_start" TIMESTAMPTZ(6),
  ADD COLUMN "current_period_end" TIMESTAMPTZ(6),
  ADD COLUMN "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "canceled_at" TIMESTAMPTZ(6),
  ADD COLUMN "grace_started_at" TIMESTAMPTZ(6),
  ADD COLUMN "grace_ends_at" TIMESTAMPTZ(6),
  ADD COLUMN "restricted_at" TIMESTAMPTZ(6),
  ADD COLUMN "pending_plan_version_id" UUID,
  ADD COLUMN "pending_billing_price_id" UUID,
  ADD COLUMN "pending_change_effective_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "super_agency_subscriptions_stripe_subscription_id_key"
  ON "super_agency_subscriptions"("stripe_subscription_id")
  WHERE "stripe_subscription_id" IS NOT NULL;
CREATE INDEX "super_agency_subscriptions_billing_price_id_idx"
  ON "super_agency_subscriptions"("billing_price_id");
CREATE INDEX "super_agency_subscriptions_provider_provider_status_idx"
  ON "super_agency_subscriptions"("provider", "provider_status");
CREATE INDEX "super_agency_subscriptions_trial_ends_at_idx"
  ON "super_agency_subscriptions"("trial_ends_at");
CREATE INDEX "super_agency_subscriptions_grace_ends_at_idx"
  ON "super_agency_subscriptions"("grace_ends_at");
CREATE INDEX "super_agency_subscriptions_pending_change_effective_at_idx"
  ON "super_agency_subscriptions"("pending_change_effective_at");

ALTER TABLE "super_agency_subscriptions"
  ADD CONSTRAINT "super_agency_subscriptions_billing_price_id_fkey"
  FOREIGN KEY ("billing_price_id") REFERENCES "billing_prices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "super_agency_billing_accounts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "super_agency_id" UUID NOT NULL,
  "provider" "BillingProvider" NOT NULL DEFAULT 'STRIPE',
  "stripe_customer_id" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "super_agency_billing_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_agency_billing_accounts_super_agency_id_key"
  ON "super_agency_billing_accounts"("super_agency_id");
CREATE UNIQUE INDEX "super_agency_billing_accounts_stripe_customer_id_key"
  ON "super_agency_billing_accounts"("stripe_customer_id")
  WHERE "stripe_customer_id" IS NOT NULL;
CREATE INDEX "super_agency_billing_accounts_provider_idx"
  ON "super_agency_billing_accounts"("provider");

ALTER TABLE "super_agency_billing_accounts"
  ADD CONSTRAINT "super_agency_billing_accounts_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "billing_checkout_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "super_agency_id" UUID NOT NULL,
  "master_plan_id" UUID NOT NULL,
  "plan_version_id" UUID NOT NULL,
  "billing_price_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "status" "BillingCheckoutAttemptStatus" NOT NULL DEFAULT 'OPEN',
  "interval" "BillingInterval" NOT NULL,
  "stripe_session_id" VARCHAR(120),
  "stripe_subscription_id" VARCHAR(120),
  "idempotency_key" VARCHAR(160) NOT NULL,
  "completed_at" TIMESTAMPTZ(6),
  "expires_at" TIMESTAMPTZ(6),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_checkout_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_checkout_attempts_stripe_session_id_key"
  ON "billing_checkout_attempts"("stripe_session_id")
  WHERE "stripe_session_id" IS NOT NULL;
CREATE UNIQUE INDEX "billing_checkout_attempts_idempotency_key_key"
  ON "billing_checkout_attempts"("idempotency_key");
CREATE INDEX "billing_checkout_attempts_super_agency_id_status_created_at_idx"
  ON "billing_checkout_attempts"("super_agency_id", "status", "created_at");
CREATE INDEX "billing_checkout_attempts_billing_price_id_idx"
  ON "billing_checkout_attempts"("billing_price_id");
CREATE INDEX "billing_checkout_attempts_stripe_subscription_id_idx"
  ON "billing_checkout_attempts"("stripe_subscription_id");

ALTER TABLE "billing_checkout_attempts"
  ADD CONSTRAINT "billing_checkout_attempts_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_checkout_attempts"
  ADD CONSTRAINT "billing_checkout_attempts_master_plan_id_fkey"
  FOREIGN KEY ("master_plan_id") REFERENCES "master_plans"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_checkout_attempts"
  ADD CONSTRAINT "billing_checkout_attempts_plan_version_id_fkey"
  FOREIGN KEY ("plan_version_id") REFERENCES "master_plan_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_checkout_attempts"
  ADD CONSTRAINT "billing_checkout_attempts_billing_price_id_fkey"
  FOREIGN KEY ("billing_price_id") REFERENCES "billing_prices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_checkout_attempts"
  ADD CONSTRAINT "billing_checkout_attempts_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stripe_billing_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "stripe_event_id" VARCHAR(120) NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "status" "StripeBillingEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "super_agency_id" UUID,
  "stripe_customer_id" VARCHAR(120),
  "stripe_subscription_id" VARCHAR(120),
  "stripe_checkout_session_id" VARCHAR(120),
  "provider_created_at" TIMESTAMPTZ(6),
  "processed_at" TIMESTAMPTZ(6),
  "safe_error_code" VARCHAR(120),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stripe_billing_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stripe_billing_events_stripe_event_id_key"
  ON "stripe_billing_events"("stripe_event_id");
CREATE INDEX "stripe_billing_events_event_type_created_at_idx"
  ON "stripe_billing_events"("event_type", "created_at");
CREATE INDEX "stripe_billing_events_status_created_at_idx"
  ON "stripe_billing_events"("status", "created_at");
CREATE INDEX "stripe_billing_events_super_agency_id_created_at_idx"
  ON "stripe_billing_events"("super_agency_id", "created_at");
CREATE INDEX "stripe_billing_events_stripe_customer_id_idx"
  ON "stripe_billing_events"("stripe_customer_id");
CREATE INDEX "stripe_billing_events_stripe_subscription_id_idx"
  ON "stripe_billing_events"("stripe_subscription_id");

ALTER TABLE "stripe_billing_events"
  ADD CONSTRAINT "stripe_billing_events_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
