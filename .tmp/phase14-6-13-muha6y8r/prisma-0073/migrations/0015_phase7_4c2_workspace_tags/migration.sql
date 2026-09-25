CREATE TYPE "WorkspaceTagStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "workspace_tags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "name_normalized" VARCHAR(80) NOT NULL,
  "color" VARCHAR(7),
  "status" "WorkspaceTagStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "workspace_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_tags" (
  "workspace_id" UUID NOT NULL,
  "task_id" UUID NOT NULL,
  "tag_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "task_tags_pkey" PRIMARY KEY ("task_id","tag_id")
);

CREATE UNIQUE INDEX "workspace_tags_workspace_id_name_normalized_key" ON "workspace_tags"("workspace_id","name_normalized");
CREATE UNIQUE INDEX "workspace_tags_id_workspace_id_key" ON "workspace_tags"("id","workspace_id");
CREATE INDEX "workspace_tags_workspace_id_status_name_normalized_idx" ON "workspace_tags"("workspace_id","status","name_normalized");
CREATE INDEX "workspace_tags_workspace_id_created_at_idx" ON "workspace_tags"("workspace_id","created_at");

CREATE INDEX "task_tags_workspace_id_task_id_created_at_idx" ON "task_tags"("workspace_id","task_id","created_at");
CREATE INDEX "task_tags_workspace_id_tag_id_created_at_idx" ON "task_tags"("workspace_id","tag_id","created_at");

ALTER TABLE "workspace_tags" ADD CONSTRAINT "workspace_tags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_tags" ADD CONSTRAINT "workspace_tags_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_task_id_workspace_id_fkey" FOREIGN KEY ("task_id","workspace_id") REFERENCES "tasks"("id","workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_tag_id_workspace_id_fkey" FOREIGN KEY ("tag_id","workspace_id") REFERENCES "workspace_tags"("id","workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "task_tags" ADD CONSTRAINT "task_tags_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key") VALUES
  ('tags.view'),
  ('tags.create'),
  ('tags.update'),
  ('tags.archive'),
  ('tags.assign')
ON CONFLICT ("key") DO NOTHING;
