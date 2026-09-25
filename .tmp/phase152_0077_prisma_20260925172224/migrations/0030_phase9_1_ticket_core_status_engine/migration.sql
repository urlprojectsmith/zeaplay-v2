CREATE TABLE "workspace_ticket_counters" (
  "workspace_id" UUID NOT NULL,
  "last_number" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "workspace_ticket_counters_pkey" PRIMARY KEY ("workspace_id")
);

CREATE TABLE "tickets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "sequence_number" INTEGER NOT NULL,
  "ticket_number" VARCHAR(16) NOT NULL,
  "subject" VARCHAR(200) NOT NULL,
  "description" VARCHAR(4000),
  "status_definition_id" UUID NOT NULL,
  "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "created_by_membership_id" UUID,
  "deleted_at" TIMESTAMPTZ(6),
  "deleted_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tickets_id_workspace_id_key" ON "tickets"("id", "workspace_id");
CREATE UNIQUE INDEX "tickets_workspace_id_sequence_number_key" ON "tickets"("workspace_id", "sequence_number");
CREATE UNIQUE INDEX "tickets_workspace_id_ticket_number_key" ON "tickets"("workspace_id", "ticket_number");
CREATE INDEX "tickets_workspace_id_deleted_at_idx" ON "tickets"("workspace_id", "deleted_at");
CREATE INDEX "tickets_workspace_id_status_definition_id_idx" ON "tickets"("workspace_id", "status_definition_id");
CREATE INDEX "tickets_workspace_id_priority_idx" ON "tickets"("workspace_id", "priority");
CREATE INDEX "tickets_workspace_id_created_at_idx" ON "tickets"("workspace_id", "created_at");
CREATE INDEX "tickets_workspace_id_updated_at_idx" ON "tickets"("workspace_id", "updated_at");
CREATE INDEX "tickets_workspace_id_created_by_membership_id_idx" ON "tickets"("workspace_id", "created_by_membership_id");

ALTER TABLE "workspace_ticket_counters"
  ADD CONSTRAINT "workspace_ticket_counters_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_status_definition_id_workspace_id_fkey"
  FOREIGN KEY ("status_definition_id", "workspace_id") REFERENCES "status_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_created_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("created_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_deleted_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("deleted_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

WITH ticket_template AS (
  SELECT *
  FROM (
    VALUES
      ('New', 'new', '#64748B', 1, 'TODO', true, false),
      ('Open', 'open', '#0891B2', 2, 'TODO', false, false),
      ('In Progress', 'in progress', '#2563EB', 3, 'IN_PROGRESS', false, false),
      ('Waiting on Requester', 'waiting on requester', '#D97706', 4, 'REVIEW', false, false),
      ('Resolved', 'resolved', '#16A34A', 5, 'COMPLETED', false, true),
      ('Closed', 'closed', '#475569', 6, 'COMPLETED', false, true)
  ) AS template("name", "name_normalized", "color", "position", "category", "is_default", "is_terminal")
)
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
  "created_at",
  "updated_at"
)
SELECT
  "workspaces"."id",
  'TICKET'::"StatusEntityType",
  ticket_template."name",
  ticket_template."name_normalized",
  ticket_template."color",
  ticket_template."position",
  ticket_template."category"::"StatusCategory",
  ticket_template."is_default",
  ticket_template."is_terminal",
  true,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "workspaces"
CROSS JOIN ticket_template
WHERE NOT EXISTS (
  SELECT 1
  FROM "status_definitions"
  WHERE "status_definitions"."workspace_id" = "workspaces"."id"
    AND "status_definitions"."entity_type" = 'TICKET'::"StatusEntityType"
    AND "status_definitions"."name_normalized" = ticket_template."name_normalized"
)
ON CONFLICT ("workspace_id", "entity_type", "name_normalized") DO NOTHING;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('tickets.view', 'tickets.view permission'),
  ('tickets.create', 'tickets.create permission'),
  ('tickets.update', 'tickets.update permission'),
  ('tickets.delete', 'tickets.delete permission')
ON CONFLICT ("key") DO NOTHING;

WITH ticket_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('tickets.view', 'tickets.create', 'tickets.update', 'tickets.delete')
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'tickets.view'),
      ('OWNER', 'tickets.create'),
      ('OWNER', 'tickets.update'),
      ('OWNER', 'tickets.delete'),
      ('ADMIN', 'tickets.view'),
      ('ADMIN', 'tickets.create'),
      ('ADMIN', 'tickets.update'),
      ('ADMIN', 'tickets.delete'),
      ('MANAGER', 'tickets.view'),
      ('MANAGER', 'tickets.create'),
      ('MANAGER', 'tickets.update'),
      ('MANAGER', 'tickets.delete'),
      ('MEMBER', 'tickets.view'),
      ('MEMBER', 'tickets.create')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", ticket_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN ticket_permissions ON ticket_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'::"RoleScope"
  AND roles."is_system" = true
  AND roles."workspace_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
