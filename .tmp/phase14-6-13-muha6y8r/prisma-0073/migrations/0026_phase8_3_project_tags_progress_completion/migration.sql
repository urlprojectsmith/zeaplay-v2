ALTER TABLE "projects"
  ADD COLUMN "manual_progress_percent" INTEGER,
  ADD COLUMN "manual_progress_updated_by_membership_id" UUID,
  ADD COLUMN "manual_progress_updated_at" TIMESTAMPTZ(6);

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_manual_progress_percent_check"
  CHECK ("manual_progress_percent" IS NULL OR ("manual_progress_percent" >= 0 AND "manual_progress_percent" <= 100));

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_manual_progress_updated_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("manual_progress_updated_by_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;

CREATE INDEX "projects_workspace_id_manual_progress_updated_by_membership_id_idx"
  ON "projects"("workspace_id", "manual_progress_updated_by_membership_id");

CREATE TABLE "project_tags" (
  "workspace_id" UUID NOT NULL,
  "project_id" UUID NOT NULL,
  "tag_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "project_tags_pkey" PRIMARY KEY ("project_id", "tag_id"),
  CONSTRAINT "project_tags_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_tags_project_id_workspace_id_fkey"
    FOREIGN KEY ("project_id", "workspace_id") REFERENCES "projects"("id", "workspace_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_tags_tag_id_workspace_id_fkey"
    FOREIGN KEY ("tag_id", "workspace_id") REFERENCES "workspace_tags"("id", "workspace_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_tags_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "project_tags_workspace_id_project_id_created_at_idx"
  ON "project_tags"("workspace_id", "project_id", "created_at");

CREATE INDEX "project_tags_workspace_id_tag_id_created_at_idx"
  ON "project_tags"("workspace_id", "tag_id", "created_at");
