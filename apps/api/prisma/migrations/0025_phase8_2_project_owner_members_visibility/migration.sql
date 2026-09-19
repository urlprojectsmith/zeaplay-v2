-- Phase 8.2 Project Owner + Members + Visibility.
-- Project owner/member authority is WorkspaceMembership-based.

CREATE TYPE "ProjectVisibility" AS ENUM ('WORKSPACE', 'RESTRICTED');

ALTER TABLE "projects"
  ADD COLUMN "visibility" "ProjectVisibility" NOT NULL DEFAULT 'WORKSPACE',
  ADD COLUMN "owner_membership_id" UUID;

UPDATE "projects" AS "project"
SET "owner_membership_id" = "membership"."id"
FROM "workspace_memberships" AS "membership"
WHERE "project"."owner_membership_id" IS NULL
  AND "membership"."workspace_id" = "project"."workspace_id"
  AND "membership"."user_id" = "project"."created_by_id"
  AND "membership"."status" = 'ACTIVE';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "projects"
    WHERE "owner_membership_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Project ownerMembershipId backfill failed during Phase 8.2 migration';
  END IF;
END $$;

ALTER TABLE "projects"
  ALTER COLUMN "owner_membership_id" SET NOT NULL;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_owner_membership_id_workspace_id_fkey"
  FOREIGN KEY ("owner_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "project_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "workspace_membership_id" UUID NOT NULL,
  "added_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_workspace_id_fkey"
  FOREIGN KEY ("workspace_id")
  REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_project_id_workspace_id_fkey"
  FOREIGN KEY ("project_id", "workspace_id")
  REFERENCES "projects"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_workspace_membership_id_workspace_id_fkey"
  FOREIGN KEY ("workspace_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_members"
  ADD CONSTRAINT "project_members_added_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("added_by_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "project_members_project_id_workspace_membership_id_key"
  ON "project_members"("project_id", "workspace_membership_id");

CREATE INDEX "projects_workspace_id_visibility_idx"
  ON "projects"("workspace_id", "visibility");

CREATE INDEX "projects_workspace_id_owner_membership_id_idx"
  ON "projects"("workspace_id", "owner_membership_id");

CREATE INDEX "project_members_workspace_id_project_id_idx"
  ON "project_members"("workspace_id", "project_id");

CREATE INDEX "project_members_workspace_id_workspace_membership_id_idx"
  ON "project_members"("workspace_id", "workspace_membership_id");
