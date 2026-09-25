-- Phase 14.6.2: canonical Super Agency tenant foundation.
-- Legacy backfill intentionally creates one compatibility Super Agency per existing Agency.
-- This preserves current tenant isolation and never groups unrelated Agencies under one parent.

CREATE TYPE "SuperAgencyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

ALTER TYPE "RoleScope" ADD VALUE IF NOT EXISTS 'SUPER_AGENCY';

CREATE TABLE "super_agencies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(160) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "status" "SuperAgencyStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "super_agencies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_agencies_slug_key" ON "super_agencies"("slug");
CREATE INDEX "super_agencies_status_idx" ON "super_agencies"("status");
CREATE INDEX "super_agencies_created_by_id_idx" ON "super_agencies"("created_by_id");

ALTER TABLE "super_agencies"
  ADD CONSTRAINT "super_agencies_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agencies" ADD COLUMN "super_agency_id" UUID;

INSERT INTO "super_agencies" ("id", "name", "slug", "status", "created_by_id", "created_at", "updated_at")
SELECT
  "id",
  LEFT("name", 153) || ' Parent',
  LEFT("slug", 83) || '-parent-' || SUBSTRING("id"::TEXT FROM 1 FOR 8),
  'ACTIVE'::"SuperAgencyStatus",
  "created_by_id",
  "created_at",
  CURRENT_TIMESTAMP
FROM "agencies"
ON CONFLICT ("id") DO NOTHING;

UPDATE "agencies"
SET "super_agency_id" = "id"
WHERE "super_agency_id" IS NULL;

ALTER TABLE "agencies" ALTER COLUMN "super_agency_id" SET NOT NULL;

ALTER TABLE "agencies"
  ADD CONSTRAINT "agencies_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "agencies_super_agency_id_idx" ON "agencies"("super_agency_id");
CREATE INDEX "agencies_super_agency_id_status_idx" ON "agencies"("super_agency_id", "status");

CREATE TABLE "super_agency_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "super_agency_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "super_agency_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_agency_memberships_user_id_super_agency_id_key"
  ON "super_agency_memberships"("user_id", "super_agency_id");
CREATE INDEX "super_agency_memberships_super_agency_id_idx"
  ON "super_agency_memberships"("super_agency_id");
CREATE INDEX "super_agency_memberships_super_agency_id_status_idx"
  ON "super_agency_memberships"("super_agency_id", "status");
CREATE INDEX "super_agency_memberships_user_id_idx"
  ON "super_agency_memberships"("user_id");

ALTER TABLE "super_agency_memberships"
  ADD CONSTRAINT "super_agency_memberships_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "super_agency_memberships"
  ADD CONSTRAINT "super_agency_memberships_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "super_agency_memberships"
  ADD CONSTRAINT "super_agency_memberships_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "feature_entitlements" ADD COLUMN "super_agency_id" UUID;

CREATE INDEX "feature_entitlements_super_agency_id_idx"
  ON "feature_entitlements"("super_agency_id");

ALTER TABLE "feature_entitlements"
  ADD CONSTRAINT "feature_entitlements_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD COLUMN "super_agency_id" UUID;

CREATE INDEX "audit_logs_super_agency_id_created_at_idx"
  ON "audit_logs"("super_agency_id", "created_at");

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
