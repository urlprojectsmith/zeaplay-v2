CREATE TYPE "TicketRequesterType" AS ENUM ('INTERNAL', 'EXTERNAL');

ALTER TABLE "tickets"
  ADD COLUMN "department_id" UUID,
  ADD COLUMN "assigned_to_membership_id" UUID;

CREATE TABLE "ticket_requesters" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "ticket_id" UUID NOT NULL,
  "type" "TicketRequesterType" NOT NULL,
  "internal_membership_id" UUID,
  "external_name" VARCHAR(160),
  "external_email" VARCHAR(320),
  "external_phone" VARCHAR(40),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_requesters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_requesters_type_shape_check" CHECK (
    (
      "type" = 'INTERNAL'
      AND "internal_membership_id" IS NOT NULL
      AND "external_name" IS NULL
      AND "external_email" IS NULL
      AND "external_phone" IS NULL
    )
    OR
    (
      "type" = 'EXTERNAL'
      AND "internal_membership_id" IS NULL
      AND "external_name" IS NOT NULL
      AND ("external_email" IS NOT NULL OR "external_phone" IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX "ticket_requesters_ticket_id_key" ON "ticket_requesters"("ticket_id");
CREATE UNIQUE INDEX "ticket_requesters_ticket_id_workspace_id_key" ON "ticket_requesters"("ticket_id", "workspace_id");
CREATE INDEX "ticket_requesters_workspace_id_internal_membership_id_idx" ON "ticket_requesters"("workspace_id", "internal_membership_id");
CREATE INDEX "ticket_requesters_workspace_id_type_idx" ON "ticket_requesters"("workspace_id", "type");

CREATE INDEX "tickets_workspace_id_department_id_deleted_at_idx" ON "tickets"("workspace_id", "department_id", "deleted_at");
CREATE INDEX "tickets_workspace_id_assigned_to_membership_id_deleted_at_idx" ON "tickets"("workspace_id", "assigned_to_membership_id", "deleted_at");

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_assignee_requires_department_check"
  CHECK ("assigned_to_membership_id" IS NULL OR "department_id" IS NOT NULL);

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_department_id_workspace_id_fkey"
  FOREIGN KEY ("department_id", "workspace_id") REFERENCES "departments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_assigned_to_membership_id_workspace_id_fkey"
  FOREIGN KEY ("assigned_to_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_requesters"
  ADD CONSTRAINT "ticket_requesters_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_requesters"
  ADD CONSTRAINT "ticket_requesters_ticket_id_workspace_id_fkey"
  FOREIGN KEY ("ticket_id", "workspace_id") REFERENCES "tickets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_requesters"
  ADD CONSTRAINT "ticket_requesters_internal_membership_id_workspace_id_fkey"
  FOREIGN KEY ("internal_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('tickets.view_all', 'tickets.view_all permission'),
  ('tickets.assign', 'tickets.assign permission'),
  ('tickets.manage_requester', 'tickets.manage_requester permission')
ON CONFLICT ("key") DO NOTHING;

WITH ticket_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('tickets.view_all', 'tickets.assign', 'tickets.manage_requester')
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'tickets.view_all'),
      ('OWNER', 'tickets.assign'),
      ('OWNER', 'tickets.manage_requester'),
      ('ADMIN', 'tickets.view_all'),
      ('ADMIN', 'tickets.assign'),
      ('ADMIN', 'tickets.manage_requester'),
      ('MANAGER', 'tickets.view_all'),
      ('MANAGER', 'tickets.assign'),
      ('MANAGER', 'tickets.manage_requester')
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
