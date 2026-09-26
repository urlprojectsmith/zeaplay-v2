-- Phase 17.1 analytics foundation.
-- Rollups are derived/cache data. This migration intentionally performs no backfill.

CREATE TYPE "AnalyticsScopeType" AS ENUM ('WORKSPACE', 'AGENCY', 'SUPER_AGENCY', 'PLATFORM');
CREATE TYPE "AnalyticsBucket" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH');

CREATE TABLE "analytics_rollups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scope_type" "AnalyticsScopeType" NOT NULL,
  "scope_id" UUID NOT NULL,
  "workspace_id" UUID,
  "metric_key" VARCHAR(120) NOT NULL,
  "bucket" "AnalyticsBucket" NOT NULL,
  "bucket_start" TIMESTAMPTZ(6) NOT NULL,
  "bucket_end" TIMESTAMPTZ(6) NOT NULL,
  "dimension_key" VARCHAR(80),
  "dimension_value" VARCHAR(160),
  "value" DECIMAL(30, 6) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "source_hash" VARCHAR(96),
  "rebuilt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "analytics_rollups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "analytics_rollups_bucket_window_check" CHECK ("bucket_end" > "bucket_start")
);

ALTER TABLE "analytics_rollups"
  ADD CONSTRAINT "analytics_rollups_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "analytics_rollups_scope_metric_bucket_dimension_key"
  ON "analytics_rollups" (
    "scope_type",
    "scope_id",
    "metric_key",
    "bucket",
    "bucket_start",
    COALESCE("dimension_key", ''),
    COALESCE("dimension_value", ''),
    "version"
  );

CREATE INDEX "analytics_rollups_scope_metric_start_idx"
  ON "analytics_rollups" ("scope_type", "scope_id", "metric_key", "bucket_start");

CREATE INDEX "analytics_rollups_workspace_metric_start_idx"
  ON "analytics_rollups" ("workspace_id", "metric_key", "bucket_start");

CREATE INDEX "analytics_rollups_metric_bucket_start_idx"
  ON "analytics_rollups" ("metric_key", "bucket", "bucket_start");
