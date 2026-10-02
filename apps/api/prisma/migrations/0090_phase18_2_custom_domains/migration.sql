-- Phase 18.2 custom domains, DNS ownership, host resolution, and NPM provisioning foundation.
-- Additive only. Does not modify migrations 0001 through 0089.

CREATE TYPE "CustomDomainScopeType" AS ENUM ('SUPER_AGENCY', 'AGENCY', 'WORKSPACE');

CREATE TYPE "CustomDomainStatus" AS ENUM (
  'PENDING_VERIFICATION',
  'DNS_VERIFIED',
  'ROUTING_PENDING',
  'SSL_PENDING',
  'ACTIVE',
  'FAILED',
  'SUSPENDED',
  'REMOVING',
  'REMOVED'
);

CREATE TABLE "custom_domains" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope_type" "CustomDomainScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "super_agency_id" UUID,
  "agency_id" UUID,
  "workspace_id" UUID,
  "hostname" VARCHAR(253) NOT NULL,
  "normalized_hostname" VARCHAR(253) NOT NULL,
  "display_hostname" VARCHAR(253),
  "status" "CustomDomainStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
  "verification_token_hash" CHAR(64) NOT NULL,
  "verification_token_created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "verification_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "verified_at" TIMESTAMPTZ(6),
  "last_dns_checked_at" TIMESTAMPTZ(6),
  "routing_verified_at" TIMESTAMPTZ(6),
  "ssl_requested_at" TIMESTAMPTZ(6),
  "ssl_active_at" TIMESTAMPTZ(6),
  "failure_code" VARCHAR(120),
  "failure_message_safe" VARCHAR(500),
  "consecutive_failure_count" INTEGER NOT NULL DEFAULT 0,
  "npm_proxy_host_id" VARCHAR(120),
  "npm_certificate_id" VARCHAR(120),
  "provisioning_attempt" INTEGER NOT NULL DEFAULT 0,
  "reconciliation_due_at" TIMESTAMPTZ(6),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "created_by_id" UUID,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),

  CONSTRAINT "custom_domains_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custom_domains_scope_lineage_check" CHECK (
    (
      "scope_type" = 'SUPER_AGENCY'
      AND "scope_id" = "super_agency_id"
      AND "agency_id" IS NULL
      AND "workspace_id" IS NULL
    )
    OR (
      "scope_type" = 'AGENCY'
      AND "scope_id" = "agency_id"
      AND "super_agency_id" IS NOT NULL
      AND "workspace_id" IS NULL
    )
    OR (
      "scope_type" = 'WORKSPACE'
      AND "scope_id" = "workspace_id"
      AND "super_agency_id" IS NOT NULL
      AND "agency_id" IS NOT NULL
    )
  ),
  CONSTRAINT "custom_domains_removed_status_check" CHECK (
    ("status" = 'REMOVED' AND "removed_at" IS NOT NULL)
    OR ("status" <> 'REMOVED')
  )
);

CREATE UNIQUE INDEX "custom_domains_active_hostname_key"
  ON "custom_domains" ("normalized_hostname")
  WHERE "removed_at" IS NULL AND "status" <> 'REMOVED';

CREATE UNIQUE INDEX "custom_domains_active_scope_key"
  ON "custom_domains" ("scope_type", "scope_id")
  WHERE "removed_at" IS NULL AND "status" <> 'REMOVED';

CREATE INDEX "custom_domains_normalized_hostname_idx" ON "custom_domains" ("normalized_hostname");
CREATE INDEX "custom_domains_scope_status_idx" ON "custom_domains" ("scope_type", "scope_id", "status");
CREATE INDEX "custom_domains_reconcile_idx" ON "custom_domains" ("status", "reconciliation_due_at");
CREATE INDEX "custom_domains_verification_expiry_idx" ON "custom_domains" ("verification_expires_at");
CREATE INDEX "custom_domains_super_agency_status_idx" ON "custom_domains" ("super_agency_id", "status");
CREATE INDEX "custom_domains_agency_status_idx" ON "custom_domains" ("agency_id", "status");
CREATE INDEX "custom_domains_workspace_status_idx" ON "custom_domains" ("workspace_id", "status");

INSERT INTO "permissions" ("key", "name", "description", "created_at", "updated_at")
VALUES
  (
    'custom_domains.manage',
    'Manage custom domains',
    'Create, verify, provision, suspend, and remove tenant custom domains.',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("key") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updated_at" = CURRENT_TIMESTAMP;
