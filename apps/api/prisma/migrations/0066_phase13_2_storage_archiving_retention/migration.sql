CREATE TYPE "AssetLifecycle" AS ENUM (
  'ACTIVE',
  'ARCHIVED',
  'PENDING_DELETE',
  'PURGING',
  'PURGED'
);

ALTER TABLE "assets" ADD COLUMN "lifecycle" "AssetLifecycle" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "assets" ADD COLUMN "delete_requested_at" TIMESTAMPTZ(6);
ALTER TABLE "assets" ADD COLUMN "purge_after" TIMESTAMPTZ(6);
ALTER TABLE "assets" ADD COLUMN "purging_started_at" TIMESTAMPTZ(6);
ALTER TABLE "assets" ADD COLUMN "purged_at" TIMESTAMPTZ(6);
ALTER TABLE "assets" ADD COLUMN "purge_failure_code" VARCHAR(80);
ALTER TABLE "assets" ADD COLUMN "purge_failure_at" TIMESTAMPTZ(6);

CREATE TABLE "storage_retention_policies" (
  "workspace_id" UUID NOT NULL,
  "delete_grace_days" INTEGER NOT NULL DEFAULT 30,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "storage_retention_policies_pkey" PRIMARY KEY ("workspace_id")
);

CREATE INDEX "assets_workspace_id_lifecycle_created_at_idx" ON "assets"("workspace_id", "lifecycle", "created_at");
CREATE INDEX "assets_lifecycle_purge_after_idx" ON "assets"("lifecycle", "purge_after");
CREATE INDEX "assets_workspace_id_lifecycle_purge_after_idx" ON "assets"("workspace_id", "lifecycle", "purge_after");
CREATE INDEX "storage_upload_reservations_expires_at_idx" ON "storage_upload_reservations"("expires_at");

ALTER TABLE "storage_retention_policies" ADD CONSTRAINT "storage_retention_policies_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
