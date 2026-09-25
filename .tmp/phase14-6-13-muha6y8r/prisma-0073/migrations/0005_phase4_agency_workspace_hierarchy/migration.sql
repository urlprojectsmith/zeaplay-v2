CREATE TYPE "AgencyStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');
CREATE TYPE "RoleScope" AS ENUM ('LEGACY_ORGANIZATION', 'AGENCY', 'WORKSPACE');

ALTER TABLE "roles" ADD COLUMN "key" VARCHAR(120);
ALTER TABLE "roles" ADD COLUMN "scope" "RoleScope" NOT NULL DEFAULT 'WORKSPACE';
ALTER TABLE "roles" ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "roles" ADD COLUMN "workspace_id" UUID;
UPDATE "roles" SET "key" = "name" WHERE "key" IS NULL;
ALTER TABLE "roles" ALTER COLUMN "key" SET NOT NULL;
DROP INDEX IF EXISTS "roles_name_key";
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");
CREATE INDEX "roles_scope_idx" ON "roles"("scope");
CREATE INDEX "roles_workspace_id_idx" ON "roles"("workspace_id");

CREATE TABLE "agencies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(160) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "status" "AgencyStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspaces" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "agency_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
  "storage_used_bytes" BIGINT NOT NULL DEFAULT 0,
  "storage_limit_bytes" BIGINT NOT NULL DEFAULT 1073741824,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agency_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "agency_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "agency_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "role_id" UUID NOT NULL,
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "feature_definitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(240),
  "enabled_by_default" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "feature_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "feature_entitlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "feature_id" UUID NOT NULL,
  "agency_id" UUID,
  "workspace_id" UUID,
  "enabled" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "feature_entitlements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agencies_slug_key" ON "agencies"("slug");
CREATE INDEX "agencies_status_idx" ON "agencies"("status");
CREATE INDEX "agencies_created_by_id_idx" ON "agencies"("created_by_id");
CREATE UNIQUE INDEX "workspaces_agency_id_slug_key" ON "workspaces"("agency_id", "slug");
CREATE UNIQUE INDEX "workspaces_id_agency_id_key" ON "workspaces"("id", "agency_id");
CREATE INDEX "workspaces_agency_id_idx" ON "workspaces"("agency_id");
CREATE INDEX "workspaces_agency_id_status_idx" ON "workspaces"("agency_id", "status");
CREATE UNIQUE INDEX "agency_memberships_user_id_agency_id_key" ON "agency_memberships"("user_id", "agency_id");
CREATE INDEX "agency_memberships_agency_id_idx" ON "agency_memberships"("agency_id");
CREATE INDEX "agency_memberships_user_id_idx" ON "agency_memberships"("user_id");
CREATE UNIQUE INDEX "workspace_memberships_user_id_workspace_id_key" ON "workspace_memberships"("user_id", "workspace_id");
CREATE INDEX "workspace_memberships_workspace_id_idx" ON "workspace_memberships"("workspace_id");
CREATE INDEX "workspace_memberships_user_id_idx" ON "workspace_memberships"("user_id");
CREATE UNIQUE INDEX "feature_definitions_key_key" ON "feature_definitions"("key");
CREATE UNIQUE INDEX "feature_entitlements_feature_id_agency_id_workspace_id_key" ON "feature_entitlements"("feature_id", "agency_id", "workspace_id");
CREATE INDEX "feature_entitlements_agency_id_idx" ON "feature_entitlements"("agency_id");
CREATE INDEX "feature_entitlements_workspace_id_idx" ON "feature_entitlements"("workspace_id");

ALTER TABLE "agencies" ADD CONSTRAINT "agencies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "agency_memberships" ADD CONSTRAINT "agency_memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "feature_entitlements" ADD CONSTRAINT "feature_entitlements_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "feature_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feature_entitlements" ADD CONSTRAINT "feature_entitlements_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "feature_entitlements" ADD CONSTRAINT "feature_entitlements_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

WITH owner_candidates AS (
  SELECT DISTINCT ON (m.organization_id) m.organization_id, m.user_id
  FROM "memberships" m
  ORDER BY m.organization_id, m.created_at ASC
)
INSERT INTO "agencies" ("name", "slug", "status", "created_by_id", "created_at", "updated_at")
SELECT
  CASE WHEN o.slug = 'alpha-studio' THEN 'Agency Alpha' WHEN o.slug = 'beta-lab' THEN 'Agency Beta' ELSE o.name END,
  CASE WHEN o.slug = 'alpha-studio' THEN 'agency-alpha' WHEN o.slug = 'beta-lab' THEN 'agency-beta' ELSE 'agency-' || o.slug END,
  CASE WHEN o.status = 'ACTIVE' THEN 'ACTIVE'::"AgencyStatus" ELSE 'SUSPENDED'::"AgencyStatus" END,
  COALESCE(c.user_id, (SELECT id FROM "users" ORDER BY created_at ASC LIMIT 1)),
  o.created_at,
  o.updated_at
FROM "organizations" o
LEFT JOIN owner_candidates c ON c.organization_id = o.id
WHERE EXISTS (SELECT 1 FROM "users")
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "workspaces" ("agency_id", "name", "slug", "status", "storage_used_bytes", "storage_limit_bytes", "created_by_id", "created_at", "updated_at")
SELECT a.id, o.name, o.slug,
  CASE WHEN o.status = 'ACTIVE' THEN 'ACTIVE'::"WorkspaceStatus" ELSE 'SUSPENDED'::"WorkspaceStatus" END,
  o.storage_used_bytes,
  o.storage_limit_bytes,
  COALESCE((SELECT m.user_id FROM "memberships" m WHERE m.organization_id = o.id ORDER BY m.created_at ASC LIMIT 1), (SELECT id FROM "users" ORDER BY created_at ASC LIMIT 1)),
  o.created_at,
  o.updated_at
FROM "organizations" o
JOIN "agencies" a ON a.slug = CASE WHEN o.slug = 'alpha-studio' THEN 'agency-alpha' WHEN o.slug = 'beta-lab' THEN 'agency-beta' ELSE 'agency-' || o.slug END
ON CONFLICT ("agency_id", "slug") DO NOTHING;

INSERT INTO "roles" ("key", "name", "scope", "is_system", "created_at", "updated_at")
VALUES
  ('AGENCY_OWNER', 'Agency Owner', 'AGENCY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AGENCY_ADMIN', 'Agency Admin', 'AGENCY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AGENCY_MANAGER', 'Agency Manager', 'AGENCY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('AGENCY_USER', 'Agency User', 'AGENCY', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

UPDATE "roles" SET "scope" = 'WORKSPACE' WHERE "key" IN ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER');

INSERT INTO "agency_memberships" ("user_id", "agency_id", "role_id", "status", "created_at", "updated_at")
SELECT m.user_id, a.id,
  CASE r.key
    WHEN 'OWNER' THEN (SELECT id FROM "roles" WHERE "key" = 'AGENCY_OWNER')
    WHEN 'ADMIN' THEN (SELECT id FROM "roles" WHERE "key" = 'AGENCY_ADMIN')
    WHEN 'MANAGER' THEN (SELECT id FROM "roles" WHERE "key" = 'AGENCY_MANAGER')
    ELSE (SELECT id FROM "roles" WHERE "key" = 'AGENCY_USER')
  END,
  m.status, m.created_at, m.updated_at
FROM "memberships" m
JOIN "organizations" o ON o.id = m.organization_id
JOIN "roles" r ON r.id = m.role_id
JOIN "agencies" a ON a.slug = CASE WHEN o.slug = 'alpha-studio' THEN 'agency-alpha' WHEN o.slug = 'beta-lab' THEN 'agency-beta' ELSE 'agency-' || o.slug END
ON CONFLICT ("user_id", "agency_id") DO NOTHING;

INSERT INTO "workspace_memberships" ("user_id", "workspace_id", "role_id", "status", "created_at", "updated_at")
SELECT m.user_id, w.id, m.role_id, m.status, m.created_at, m.updated_at
FROM "memberships" m
JOIN "organizations" o ON o.id = m.organization_id
JOIN "agencies" a ON a.slug = CASE WHEN o.slug = 'alpha-studio' THEN 'agency-alpha' WHEN o.slug = 'beta-lab' THEN 'agency-beta' ELSE 'agency-' || o.slug END
JOIN "workspaces" w ON w.agency_id = a.id AND w.slug = o.slug
ON CONFLICT ("user_id", "workspace_id") DO NOTHING;

ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_organization_id_fkey";
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_organization_id_fkey";
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_project_id_organization_id_fkey";
ALTER TABLE "processing_jobs" DROP CONSTRAINT IF EXISTS "processing_jobs_organization_id_fkey";
ALTER TABLE "processing_jobs" DROP CONSTRAINT IF EXISTS "processing_jobs_project_id_organization_id_fkey";
ALTER TABLE "processing_jobs" DROP CONSTRAINT IF EXISTS "processing_jobs_asset_id_project_id_organization_id_fkey";
DROP INDEX IF EXISTS "projects_organization_id_idx";
DROP INDEX IF EXISTS "projects_organization_id_status_idx";
DROP INDEX IF EXISTS "projects_organization_id_created_at_idx";
DROP INDEX IF EXISTS "projects_id_organization_id_key";
ALTER TABLE "projects" ADD COLUMN "workspace_id" UUID;
UPDATE "projects" p
SET "workspace_id" = w.id
FROM "organizations" o
JOIN "agencies" a ON a.slug = CASE WHEN o.slug = 'alpha-studio' THEN 'agency-alpha' WHEN o.slug = 'beta-lab' THEN 'agency-beta' ELSE 'agency-' || o.slug END
JOIN "workspaces" w ON w.agency_id = a.id AND w.slug = o.slug
WHERE p.organization_id = o.id;
ALTER TABLE "projects" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "projects" DROP COLUMN "organization_id";
CREATE UNIQUE INDEX "projects_id_workspace_id_key" ON "projects"("id", "workspace_id");
CREATE INDEX "projects_workspace_id_idx" ON "projects"("workspace_id");
CREATE INDEX "projects_workspace_id_status_idx" ON "projects"("workspace_id", "status");
CREATE INDEX "projects_workspace_id_created_at_idx" ON "projects"("workspace_id", "created_at");
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_organization_id_fkey";
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_project_id_organization_id_fkey";
DROP INDEX IF EXISTS "assets_organization_id_project_id_idx";
DROP INDEX IF EXISTS "assets_organization_id_project_id_status_idx";
DROP INDEX IF EXISTS "assets_organization_id_project_id_created_at_idx";
DROP INDEX IF EXISTS "assets_id_organization_id_key";
DROP INDEX IF EXISTS "assets_id_project_id_organization_id_key";
DROP INDEX IF EXISTS "assets_id_project_id_organization_id_storage_key_key";
ALTER TABLE "assets" ADD COLUMN "workspace_id" UUID;
UPDATE "assets" a
SET "workspace_id" = p.workspace_id
FROM "projects" p
WHERE a.project_id = p.id;
ALTER TABLE "assets" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "assets" DROP COLUMN "organization_id";
CREATE UNIQUE INDEX "assets_id_workspace_id_key" ON "assets"("id", "workspace_id");
CREATE UNIQUE INDEX "assets_id_project_id_workspace_id_key" ON "assets"("id", "project_id", "workspace_id");
CREATE UNIQUE INDEX "assets_id_project_id_workspace_id_storage_key_key" ON "assets"("id", "project_id", "workspace_id", "storage_key");
CREATE INDEX "assets_workspace_id_project_id_idx" ON "assets"("workspace_id", "project_id");
CREATE INDEX "assets_workspace_id_project_id_status_idx" ON "assets"("workspace_id", "project_id", "status");
CREATE INDEX "assets_workspace_id_project_id_created_at_idx" ON "assets"("workspace_id", "project_id", "created_at");
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "processing_jobs" DROP CONSTRAINT IF EXISTS "processing_jobs_organization_id_fkey";
ALTER TABLE "processing_jobs" DROP CONSTRAINT IF EXISTS "processing_jobs_project_id_organization_id_fkey";
ALTER TABLE "processing_jobs" DROP CONSTRAINT IF EXISTS "processing_jobs_asset_id_project_id_organization_id_fkey";
DROP INDEX IF EXISTS "processing_jobs_organization_id_project_id_idx";
ALTER TABLE "processing_jobs" ADD COLUMN "workspace_id" UUID;
UPDATE "processing_jobs" j
SET "workspace_id" = p.workspace_id
FROM "projects" p
WHERE j.project_id = p.id;
ALTER TABLE "processing_jobs" ALTER COLUMN "workspace_id" SET NOT NULL;
ALTER TABLE "processing_jobs" DROP COLUMN "organization_id";
CREATE INDEX "processing_jobs_workspace_id_project_id_idx" ON "processing_jobs"("workspace_id", "project_id");
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_asset_id_project_id_workspace_id_fkey" FOREIGN KEY ("asset_id", "project_id", "workspace_id") REFERENCES "assets"("id", "project_id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD COLUMN "agency_id" UUID;
ALTER TABLE "audit_logs" ADD COLUMN "workspace_id" UUID;
UPDATE "audit_logs" l
SET "agency_id" = a.id, "workspace_id" = w.id
FROM "organizations" o
JOIN "agencies" a ON a.slug = CASE WHEN o.slug = 'alpha-studio' THEN 'agency-alpha' WHEN o.slug = 'beta-lab' THEN 'agency-beta' ELSE 'agency-' || o.slug END
JOIN "workspaces" w ON w.agency_id = a.id AND w.slug = o.slug
WHERE l.organization_id = o.id;
CREATE INDEX "audit_logs_agency_id_created_at_idx" ON "audit_logs"("agency_id", "created_at");
CREATE INDEX "audit_logs_workspace_id_created_at_idx" ON "audit_logs"("workspace_id", "created_at");
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
