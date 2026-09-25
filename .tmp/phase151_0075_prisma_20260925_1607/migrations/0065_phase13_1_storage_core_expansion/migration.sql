ALTER TABLE "assets" ADD COLUMN "uploaded_by_membership_id" UUID;
ALTER TABLE "assets" ADD COLUMN "storage_provider" VARCHAR(40) NOT NULL DEFAULT 'MINIO';
ALTER TABLE "assets" ADD COLUMN "source_module" VARCHAR(40);
ALTER TABLE "assets" ADD COLUMN "source_entity_type" VARCHAR(80);
ALTER TABLE "assets" ADD COLUMN "source_entity_id" UUID;
ALTER TABLE "assets" ADD COLUMN "archived_at" TIMESTAMPTZ(6);
ALTER TABLE "assets" ADD COLUMN "pending_delete_at" TIMESTAMPTZ(6);

UPDATE "assets" AS asset
SET "uploaded_by_membership_id" = membership."id"
FROM "workspace_memberships" AS membership
WHERE membership."workspace_id" = asset."workspace_id"
  AND membership."user_id" = asset."created_by_id"
  AND asset."uploaded_by_membership_id" IS NULL;

UPDATE "assets"
SET "source_module" = CASE
    WHEN "project_id" IS NOT NULL THEN 'PROJECT'
    WHEN "metadata" ? 'taskId' THEN 'TASK'
    WHEN "metadata" ? 'ticketId' THEN 'TICKET'
    ELSE 'GENERAL'
  END,
  "source_entity_type" = CASE
    WHEN "project_id" IS NOT NULL THEN 'PROJECT'
    WHEN "metadata" ? 'taskId' THEN 'TASK'
    WHEN "metadata" ? 'ticketId' THEN 'TICKET'
    ELSE NULL
  END,
  "source_entity_id" = CASE
    WHEN "project_id" IS NOT NULL THEN "project_id"
    WHEN "metadata" ? 'taskId' AND ("metadata"->>'taskId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN ("metadata"->>'taskId')::uuid
    WHEN "metadata" ? 'ticketId' AND ("metadata"->>'ticketId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN ("metadata"->>'ticketId')::uuid
    ELSE NULL
  END
WHERE "source_module" IS NULL;

CREATE TABLE "storage_upload_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "reserved_bytes" BIGINT NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "released_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "storage_upload_reservations_pkey" PRIMARY KEY ("id")
);

INSERT INTO "storage_upload_reservations" (
  "workspace_id",
  "file_id",
  "membership_id",
  "reserved_bytes",
  "expires_at",
  "consumed_at",
  "released_at",
  "updated_at"
)
SELECT
  asset."workspace_id",
  asset."id",
  asset."uploaded_by_membership_id",
  asset."size_bytes",
  asset."upload_expires_at",
  CASE WHEN asset."status" IN ('UPLOADED', 'PROCESSING', 'READY') THEN asset."updated_at" ELSE NULL END,
  CASE WHEN asset."status" IN ('FAILED', 'DELETED') OR asset."upload_expires_at" <= NOW() THEN asset."updated_at" ELSE NULL END,
  NOW()
FROM "assets" AS asset
WHERE asset."uploaded_by_membership_id" IS NOT NULL;

CREATE UNIQUE INDEX "storage_upload_reservations_file_id_key" ON "storage_upload_reservations"("file_id");
CREATE UNIQUE INDEX "storage_upload_reservations_file_id_workspace_id_key" ON "storage_upload_reservations"("file_id", "workspace_id");
CREATE INDEX "storage_upload_reservations_workspace_id_expires_at_idx" ON "storage_upload_reservations"("workspace_id", "expires_at");
CREATE INDEX "storage_upload_reservations_workspace_id_consumed_at_expires_at_idx" ON "storage_upload_reservations"("workspace_id", "consumed_at", "expires_at");
CREATE INDEX "storage_upload_reservations_membership_id_idx" ON "storage_upload_reservations"("membership_id");
CREATE INDEX "assets_workspace_id_created_at_idx" ON "assets"("workspace_id", "created_at");
CREATE INDEX "assets_workspace_id_status_created_at_idx" ON "assets"("workspace_id", "status", "created_at");
CREATE INDEX "assets_workspace_id_source_module_source_entity_type_source_entity_id_idx" ON "assets"("workspace_id", "source_module", "source_entity_type", "source_entity_id");
CREATE INDEX "assets_uploaded_by_membership_id_idx" ON "assets"("uploaded_by_membership_id");

ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("uploaded_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "storage_upload_reservations" ADD CONSTRAINT "storage_upload_reservations_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storage_upload_reservations" ADD CONSTRAINT "storage_upload_reservations_file_id_workspace_id_fkey"
  FOREIGN KEY ("file_id", "workspace_id") REFERENCES "assets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "storage_upload_reservations" ADD CONSTRAINT "storage_upload_reservations_membership_id_workspace_id_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
