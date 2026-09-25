CREATE TYPE "AttachmentType" AS ENUM ('FILE', 'URL');

ALTER TABLE "processing_jobs" DROP CONSTRAINT IF EXISTS "processing_jobs_asset_id_project_id_workspace_id_fkey";
ALTER TABLE "processing_jobs" DROP CONSTRAINT IF EXISTS "processing_jobs_project_id_workspace_id_fkey";
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_project_id_workspace_id_fkey";

ALTER TABLE "processing_jobs" ALTER COLUMN "project_id" DROP NOT NULL;
ALTER TABLE "assets" ALTER COLUMN "project_id" DROP NOT NULL;

CREATE TABLE "attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "type" "AttachmentType" NOT NULL,
  "asset_id" UUID,
  "url" VARCHAR(2048),
  "display_name" VARCHAR(255),
  "created_by_id" UUID NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attachments_type_payload_check" CHECK (
    ("type" = 'FILE' AND "asset_id" IS NOT NULL AND "url" IS NULL)
    OR
    ("type" = 'URL' AND "asset_id" IS NULL AND "url" IS NOT NULL)
  )
);

CREATE TABLE "task_attachments" (
  "workspace_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "attached_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),
  CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("task_id", "attachment_id")
);

CREATE TABLE "project_attachments" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "attached_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),
  CONSTRAINT "project_attachments_pkey" PRIMARY KEY ("project_id", "attachment_id")
);

CREATE UNIQUE INDEX "attachments_id_workspace_id_key" ON "attachments"("id", "workspace_id");
CREATE INDEX "attachments_workspace_id_type_created_at_idx" ON "attachments"("workspace_id", "type", "created_at");
CREATE INDEX "attachments_workspace_id_asset_id_idx" ON "attachments"("workspace_id", "asset_id");
CREATE INDEX "task_attachments_workspace_id_task_id_removed_at_created_at_idx" ON "task_attachments"("workspace_id", "task_id", "removed_at", "created_at");
CREATE INDEX "task_attachments_workspace_id_attachment_id_removed_at_idx" ON "task_attachments"("workspace_id", "attachment_id", "removed_at");
CREATE INDEX "project_attachments_workspace_id_project_id_removed_at_created_at_idx" ON "project_attachments"("workspace_id", "project_id", "removed_at", "created_at");
CREATE INDEX "project_attachments_workspace_id_attachment_id_removed_at_idx" ON "project_attachments"("workspace_id", "attachment_id", "removed_at");

ALTER TABLE "assets" ADD CONSTRAINT "assets_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_asset_id_workspace_id_fkey" FOREIGN KEY ("asset_id", "workspace_id") REFERENCES "assets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_asset_id_workspace_id_fkey" FOREIGN KEY ("asset_id", "workspace_id") REFERENCES "assets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_workspace_id_fkey" FOREIGN KEY ("task_id", "workspace_id") REFERENCES "tasks"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_attachment_id_workspace_id_fkey" FOREIGN KEY ("attachment_id", "workspace_id") REFERENCES "attachments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_attached_by_id_fkey" FOREIGN KEY ("attached_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_project_id_workspace_id_fkey" FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_attachment_id_workspace_id_fkey" FOREIGN KEY ("attachment_id", "workspace_id") REFERENCES "attachments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_attachments" ADD CONSTRAINT "project_attachments_attached_by_id_fkey" FOREIGN KEY ("attached_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "attachments" (
  "id",
  "workspace_id",
  "type",
  "asset_id",
  "url",
  "display_name",
  "created_by_id",
  "deleted_at",
  "created_at",
  "updated_at"
)
SELECT
  "id",
  "workspace_id",
  'FILE'::"AttachmentType",
  "id",
  NULL,
  "display_name",
  "created_by_id",
  "deleted_at",
  "created_at",
  "updated_at"
FROM "assets"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "project_attachments" (
  "workspace_id",
  "project_id",
  "attachment_id",
  "attached_by_id",
  "created_at",
  "removed_at"
)
SELECT
  "workspace_id",
  "project_id",
  "id",
  "created_by_id",
  "created_at",
  "deleted_at"
FROM "assets"
WHERE "project_id" IS NOT NULL
ON CONFLICT ("project_id", "attachment_id") DO NOTHING;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('tasks.attachments.view', 'tasks.attachments.view permission'),
  ('tasks.attachments.add', 'tasks.attachments.add permission'),
  ('tasks.attachments.remove', 'tasks.attachments.remove permission'),
  ('tasks.attachments.download', 'tasks.attachments.download permission')
ON CONFLICT ("key") DO NOTHING;
