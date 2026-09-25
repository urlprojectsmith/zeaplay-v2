-- Phase 8.1 Project Core + Status Migration.
-- Project.status remains temporarily for compatibility, but status_definition_id
-- becomes the runtime status authority.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS "planned_start_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "due_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "department_id" UUID;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_department_id_workspace_id_fkey"
  FOREIGN KEY ("department_id", "workspace_id")
  REFERENCES "departments"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "projects_workspace_id_priority_idx"
  ON "projects"("workspace_id", "priority");

CREATE INDEX IF NOT EXISTS "projects_workspace_id_due_at_idx"
  ON "projects"("workspace_id", "due_at");

CREATE INDEX IF NOT EXISTS "projects_workspace_id_planned_start_at_idx"
  ON "projects"("workspace_id", "planned_start_at");

CREATE INDEX IF NOT EXISTS "projects_workspace_id_department_id_idx"
  ON "projects"("workspace_id", "department_id");

-- Backfill any missing PROJECT defaults through the existing template names
-- without overwriting customized Workspaces that already have PROJECT statuses.
INSERT INTO "status_definitions" (
  "workspace_id",
  "entity_type",
  "name",
  "name_normalized",
  "color",
  "position",
  "category",
  "is_default",
  "is_terminal",
  "is_active",
  "is_system",
  "updated_at"
)
SELECT
  "workspaces"."id",
  "template"."entity_type"::"StatusEntityType",
  "template"."name",
  "template"."name_normalized",
  "template"."color",
  "template"."position",
  "template"."category"::"StatusCategory",
  "template"."is_default",
  "template"."is_terminal",
  true,
  false,
  CURRENT_TIMESTAMP
FROM "workspaces"
CROSS JOIN (
  VALUES
    ('PROJECT', 'Initial Meeting', 'initial meeting', '#64748B', 1, 'BACKLOG', true, false),
    ('PROJECT', 'Requirement Analysis', 'requirement analysis', '#0891B2', 2, 'TODO', false, false),
    ('PROJECT', 'Development', 'development', '#2563EB', 3, 'IN_PROGRESS', false, false),
    ('PROJECT', 'Testing', 'testing', '#7C3AED', 4, 'REVIEW', false, false),
    ('PROJECT', 'Client Review', 'client review', '#D97706', 5, 'REVIEW', false, false),
    ('PROJECT', 'Deployment', 'deployment', '#0D9488', 6, 'IN_PROGRESS', false, false),
    ('PROJECT', 'Completed', 'completed', '#16A34A', 7, 'COMPLETED', false, true)
) AS "template"(
  "entity_type",
  "name",
  "name_normalized",
  "color",
  "position",
  "category",
  "is_default",
  "is_terminal"
)
WHERE NOT EXISTS (
  SELECT 1
  FROM "status_definitions"
  WHERE "status_definitions"."workspace_id" = "workspaces"."id"
    AND "status_definitions"."entity_type" = 'PROJECT'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "projects"
    WHERE "status" NOT IN ('DRAFT', 'ACTIVE', 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'Unmapped legacy Project.status value found during Phase 8.1 migration';
  END IF;
END $$;

UPDATE "projects" AS "project"
SET "status_definition_id" = "status_definitions"."id"
FROM "status_definitions"
WHERE "project"."status_definition_id" IS NULL
  AND "status_definitions"."workspace_id" = "project"."workspace_id"
  AND "status_definitions"."entity_type" = 'PROJECT'
  AND "status_definitions"."name_normalized" = CASE "project"."status"
    WHEN 'DRAFT' THEN 'initial meeting'
    WHEN 'ACTIVE' THEN 'development'
    WHEN 'ARCHIVED' THEN 'completed'
  END;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "projects"
    WHERE "status_definition_id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Project statusDefinitionId backfill failed during Phase 8.1 migration';
  END IF;
END $$;
