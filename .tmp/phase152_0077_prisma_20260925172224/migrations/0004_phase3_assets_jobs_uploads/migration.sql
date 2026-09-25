CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'UPLOADING', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DELETED');
CREATE TYPE "ProcessingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

ALTER TABLE "organizations" ADD COLUMN "storage_used_bytes" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "organizations" ADD COLUMN "storage_limit_bytes" BIGINT NOT NULL DEFAULT 1073741824;
ALTER TABLE "projects" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
ALTER TABLE "refresh_tokens" ADD COLUMN "csrf_token_hash" TEXT NOT NULL DEFAULT '';

CREATE TABLE "assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "display_name" VARCHAR(255) NOT NULL,
  "storage_bucket" VARCHAR(120) NOT NULL,
  "storage_key" VARCHAR(512) NOT NULL,
  "mime_type" VARCHAR(160) NOT NULL,
  "extension" VARCHAR(24),
  "size_bytes" BIGINT NOT NULL,
  "checksum" VARCHAR(64),
  "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
  "metadata" JSONB,
  "upload_expires_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "processing_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "type" VARCHAR(80) NOT NULL,
  "status" "ProcessingJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "error_code" VARCHAR(80),
  "error_message" VARCHAR(512),
  "correlation_id" VARCHAR(120) NOT NULL,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "projects_id_organization_id_key" ON "projects"("id", "organization_id");
CREATE UNIQUE INDEX "assets_storage_key_key" ON "assets"("storage_key");
CREATE UNIQUE INDEX "assets_id_organization_id_key" ON "assets"("id", "organization_id");
CREATE UNIQUE INDEX "assets_id_project_id_organization_id_key" ON "assets"("id", "project_id", "organization_id");
CREATE UNIQUE INDEX "assets_id_project_id_organization_id_storage_key_key" ON "assets"("id", "project_id", "organization_id", "storage_key");
CREATE INDEX "assets_organization_id_project_id_idx" ON "assets"("organization_id", "project_id");
CREATE INDEX "assets_organization_id_project_id_status_idx" ON "assets"("organization_id", "project_id", "status");
CREATE INDEX "assets_organization_id_project_id_created_at_idx" ON "assets"("organization_id", "project_id", "created_at");
CREATE UNIQUE INDEX "processing_jobs_asset_id_type_key" ON "processing_jobs"("asset_id", "type");
CREATE INDEX "processing_jobs_organization_id_project_id_idx" ON "processing_jobs"("organization_id", "project_id");
CREATE INDEX "processing_jobs_asset_id_status_idx" ON "processing_jobs"("asset_id", "status");
CREATE INDEX "processing_jobs_status_created_at_idx" ON "processing_jobs"("status", "created_at");

ALTER TABLE "assets" ADD CONSTRAINT "assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "assets" ADD CONSTRAINT "assets_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_project_id_organization_id_fkey" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_asset_id_project_id_organization_id_fkey" FOREIGN KEY ("asset_id", "project_id", "organization_id") REFERENCES "assets"("id", "project_id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
