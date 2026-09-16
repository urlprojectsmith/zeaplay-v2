-- Phase 6.3A shared workspace status/pipeline engine.
CREATE TYPE "StatusEntityType" AS ENUM ('TASK', 'PROJECT', 'TICKET');
CREATE TYPE "StatusCategory" AS ENUM (
  'BACKLOG',
  'TODO',
  'IN_PROGRESS',
  'REVIEW',
  'COMPLETED',
  'CANCELLED'
);

CREATE TABLE "status_definitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "entity_type" "StatusEntityType" NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "name_normalized" VARCHAR(80) NOT NULL,
  "description" VARCHAR(240),
  "color" VARCHAR(7) NOT NULL,
  "position" INTEGER NOT NULL,
  "category" "StatusCategory" NOT NULL,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_terminal" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "status_definitions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "status_definitions"
  ADD CONSTRAINT "status_definitions_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "status_definitions_workspace_id_entity_type_name_normalized_key"
  ON "status_definitions"("workspace_id", "entity_type", "name_normalized");

CREATE UNIQUE INDEX "status_definitions_id_workspace_id_key"
  ON "status_definitions"("id", "workspace_id");

CREATE INDEX "status_definitions_workspace_id_entity_type_is_active_position_idx"
  ON "status_definitions"("workspace_id", "entity_type", "is_active", "position");

-- PostgreSQL partial unique constraint: exactly one active default is enforced
-- by service logic plus this index preventing two active defaults per type.
CREATE UNIQUE INDEX "status_definitions_one_active_default_per_type"
  ON "status_definitions"("workspace_id", "entity_type")
  WHERE "is_default" = true AND "is_active" = true;

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
    ('TASK', 'To Do', 'to do', '#64748B', 1, 'TODO', true, false),
    ('TASK', 'In Progress', 'in progress', '#2563EB', 2, 'IN_PROGRESS', false, false),
    ('TASK', 'Review', 'review', '#D97706', 3, 'REVIEW', false, false),
    ('TASK', 'Completed', 'completed', '#16A34A', 4, 'COMPLETED', false, true),
    ('PROJECT', 'Initial Meeting', 'initial meeting', '#64748B', 1, 'BACKLOG', true, false),
    ('PROJECT', 'Requirement Analysis', 'requirement analysis', '#0891B2', 2, 'TODO', false, false),
    ('PROJECT', 'Development', 'development', '#2563EB', 3, 'IN_PROGRESS', false, false),
    ('PROJECT', 'Testing', 'testing', '#7C3AED', 4, 'REVIEW', false, false),
    ('PROJECT', 'Client Review', 'client review', '#D97706', 5, 'REVIEW', false, false),
    ('PROJECT', 'Deployment', 'deployment', '#0D9488', 6, 'IN_PROGRESS', false, false),
    ('PROJECT', 'Completed', 'completed', '#16A34A', 7, 'COMPLETED', false, true),
    ('TICKET', 'New', 'new', '#64748B', 1, 'TODO', true, false),
    ('TICKET', 'Assigned', 'assigned', '#0891B2', 2, 'TODO', false, false),
    ('TICKET', 'In Progress', 'in progress', '#2563EB', 3, 'IN_PROGRESS', false, false),
    ('TICKET', 'Waiting', 'waiting', '#D97706', 4, 'REVIEW', false, false),
    ('TICKET', 'Resolved', 'resolved', '#16A34A', 5, 'COMPLETED', false, true),
    ('TICKET', 'Closed', 'closed', '#475569', 6, 'COMPLETED', false, true)
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
    AND "status_definitions"."entity_type" = "template"."entity_type"::"StatusEntityType"
);

ALTER TABLE "projects" ADD COLUMN "status_definition_id" UUID;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_status_definition_id_workspace_id_fkey"
  FOREIGN KEY ("status_definition_id", "workspace_id")
  REFERENCES "status_definitions"("id", "workspace_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "projects_workspace_id_status_definition_id_idx"
  ON "projects"("workspace_id", "status_definition_id");
