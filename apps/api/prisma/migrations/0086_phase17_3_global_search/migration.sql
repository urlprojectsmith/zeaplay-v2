CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "SearchResultType" AS ENUM (
  'TASK',
  'PROJECT',
  'TICKET',
  'DOC',
  'FORM',
  'GOAL',
  'FILE',
  'MEMBER',
  'AUTOMATION',
  'API_KEY',
  'WEBHOOK',
  'INTEGRATION',
  'BILLING_METADATA',
  'SUPER_AGENCY',
  'AGENCY',
  'WORKSPACE'
);

CREATE TYPE "SearchPrivacyClass" AS ENUM (
  'PUBLIC_METADATA',
  'WORKSPACE_OPERATIONAL',
  'ACL_SENSITIVE',
  'PARENT_SAFE_METADATA',
  'PLATFORM_SAFE_METADATA',
  'BILLING_SAFE_METADATA'
);

CREATE TYPE "SearchIndexJobStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'SKIPPED_STALE'
);

CREATE TYPE "SearchIndexOperation" AS ENUM (
  'UPSERT',
  'ARCHIVE',
  'DELETE',
  'REBUILD_SCOPE'
);

CREATE TABLE "search_documents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "workspace_id" UUID,
  "agency_id" UUID,
  "super_agency_id" UUID,
  "entity_type" "SearchResultType" NOT NULL,
  "entity_id" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "subtitle" VARCHAR(300),
  "search_text" TEXT NOT NULL,
  "route" JSONB NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "privacy_class" "SearchPrivacyClass" NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
  "indexed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source_version" INTEGER NOT NULL DEFAULT 1,
  "search_vector" tsvector NOT NULL DEFAULT ''::tsvector,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "search_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "search_documents_scope_consistency" CHECK (
    ("scope_type" = 'WORKSPACE' AND "workspace_id" = "scope_id" AND "agency_id" IS NOT NULL AND "super_agency_id" IS NOT NULL)
    OR ("scope_type" = 'AGENCY' AND "workspace_id" IS NULL AND "agency_id" = "scope_id" AND "super_agency_id" IS NOT NULL)
    OR ("scope_type" = 'SUPER_AGENCY' AND "workspace_id" IS NULL AND "agency_id" IS NULL AND "super_agency_id" = "scope_id")
    OR ("scope_type" = 'PLATFORM' AND "workspace_id" IS NULL AND "agency_id" IS NULL AND "super_agency_id" IS NULL)
  )
);

CREATE TABLE "recent_searches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "workspace_membership_id" UUID,
  "agency_membership_id" UUID,
  "super_agency_membership_id" UUID,
  "query" VARCHAR(160) NOT NULL,
  "query_normalized" VARCHAR(160) NOT NULL,
  "result_types" "SearchResultType"[] NOT NULL DEFAULT ARRAY[]::"SearchResultType"[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recent_searches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "search_index_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope_type" "AnalyticsScopeType",
  "scope_id" UUID,
  "entity_type" "SearchResultType",
  "entity_id" UUID,
  "operation" "SearchIndexOperation" NOT NULL,
  "status" "SearchIndexJobStatus" NOT NULL DEFAULT 'PENDING',
  "source_updated_at" TIMESTAMPTZ(6),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "locked_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "safe_error_code" VARCHAR(120),
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "search_index_jobs_pkey" PRIMARY KEY ("id")
);

CREATE OR REPLACE FUNCTION "search_documents_vector_refresh"()
RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    setweight(to_tsvector('simple', coalesce(NEW."title", '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW."subtitle", '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW."search_text", '')), 'C');
  NEW."indexed_at" := CURRENT_TIMESTAMP;
  NEW."updated_at" := CURRENT_TIMESTAMP;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER "search_documents_vector_refresh_trg"
BEFORE INSERT OR UPDATE OF "title", "subtitle", "search_text"
ON "search_documents"
FOR EACH ROW
EXECUTE FUNCTION "search_documents_vector_refresh"();

CREATE UNIQUE INDEX "search_documents_scope_entity_key"
ON "search_documents"("scope_type", "scope_id", "entity_type", "entity_id");

CREATE INDEX "search_documents_scope_type_updated_idx"
ON "search_documents"("scope_type", "scope_id", "entity_type", "archived", "updated_at");

CREATE INDEX "search_documents_workspace_type_idx"
ON "search_documents"("workspace_id", "entity_type", "archived");

CREATE INDEX "search_documents_agency_type_idx"
ON "search_documents"("agency_id", "entity_type", "archived");

CREATE INDEX "search_documents_super_agency_type_idx"
ON "search_documents"("super_agency_id", "entity_type", "archived");

CREATE INDEX "search_documents_vector_idx"
ON "search_documents" USING GIN ("search_vector");

CREATE INDEX "search_documents_title_trgm_idx"
ON "search_documents" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "search_documents_text_trgm_idx"
ON "search_documents" USING GIN ("search_text" gin_trgm_ops);

CREATE UNIQUE INDEX "recent_searches_user_scope_query_key"
ON "recent_searches"("user_id", "scope_type", "scope_id", "query_normalized");

CREATE INDEX "recent_searches_user_scope_updated_idx"
ON "recent_searches"("user_id", "scope_type", "scope_id", "updated_at");

CREATE INDEX "search_index_jobs_status_created_idx"
ON "search_index_jobs"("status", "created_at");

CREATE INDEX "search_index_jobs_entity_created_idx"
ON "search_index_jobs"("entity_type", "entity_id", "created_at");

INSERT INTO "permissions" ("key", "description")
VALUES
  ('search.view', 'Search authorized operational records'),
  ('search.manage', 'Rebuild and reconcile search indexes'),
  ('search.platform.read', 'Search platform-safe metadata')
ON CONFLICT ("key") DO NOTHING;

WITH search_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('search.view', 'search.manage')
),
system_role_permission_keys AS (
  SELECT *
  FROM (VALUES
    ('SUPER_AGENCY_OWNER', 'search.view'),
    ('SUPER_AGENCY_OWNER', 'search.manage'),
    ('SUPER_AGENCY_ADMIN', 'search.view'),
    ('SUPER_AGENCY_ADMIN', 'search.manage'),
    ('SUPER_AGENCY_MANAGER', 'search.view'),
    ('SUPER_AGENCY_MEMBER', 'search.view'),
    ('AGENCY_OWNER', 'search.view'),
    ('AGENCY_OWNER', 'search.manage'),
    ('AGENCY_ADMIN', 'search.view'),
    ('AGENCY_ADMIN', 'search.manage'),
    ('AGENCY_MANAGER', 'search.view'),
    ('AGENCY_USER', 'search.view'),
    ('OWNER', 'search.view'),
    ('OWNER', 'search.manage'),
    ('ADMIN', 'search.view'),
    ('ADMIN', 'search.manage'),
    ('MANAGER', 'search.view'),
    ('MEMBER', 'search.view')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", search_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN search_permissions ON search_permissions."key" = system_role_permission_keys."permission_key"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
