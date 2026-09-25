CREATE TYPE "TicketSavedViewScope" AS ENUM ('PERSONAL', 'WORKSPACE');

CREATE TABLE "ticket_saved_views" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "name_normalized" VARCHAR(120) NOT NULL,
  "scope" "TicketSavedViewScope" NOT NULL,
  "owner_membership_id" UUID,
  "filter_schema_version" INTEGER NOT NULL DEFAULT 1,
  "filters" JSONB NOT NULL,
  "sort" JSONB NOT NULL,
  "created_by_membership_id" UUID,
  "updated_by_membership_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "ticket_saved_views_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_saved_views_scope_owner_check" CHECK (
    ("scope" = 'PERSONAL' AND "owner_membership_id" IS NOT NULL)
    OR ("scope" = 'WORKSPACE' AND "owner_membership_id" IS NULL)
  ),
  CONSTRAINT "ticket_saved_views_filter_schema_version_check" CHECK ("filter_schema_version" = 1)
);

CREATE UNIQUE INDEX "ticket_saved_views_id_workspace_id_key"
  ON "ticket_saved_views"("id", "workspace_id");

CREATE UNIQUE INDEX "ticket_saved_views_personal_name_key"
  ON "ticket_saved_views"("workspace_id", "owner_membership_id", "name_normalized")
  WHERE "scope" = 'PERSONAL';

CREATE UNIQUE INDEX "ticket_saved_views_workspace_name_key"
  ON "ticket_saved_views"("workspace_id", "name_normalized")
  WHERE "scope" = 'WORKSPACE';

CREATE INDEX "ticket_saved_views_workspace_scope_idx"
  ON "ticket_saved_views"("workspace_id", "scope");

CREATE INDEX "ticket_saved_views_workspace_owner_idx"
  ON "ticket_saved_views"("workspace_id", "owner_membership_id");

ALTER TABLE "ticket_saved_views"
  ADD CONSTRAINT "ticket_saved_views_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_saved_views"
  ADD CONSTRAINT "ticket_saved_views_owner_membership_id_workspace_id_fkey"
  FOREIGN KEY ("owner_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_saved_views"
  ADD CONSTRAINT "ticket_saved_views_created_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("created_by_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_saved_views"
  ADD CONSTRAINT "ticket_saved_views_updated_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("updated_by_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('tickets.views.manage', 'tickets.views.manage permission'),
  ('tickets.views.manage_shared', 'tickets.views.manage_shared permission')
ON CONFLICT ("key") DO NOTHING;

WITH ticket_view_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('tickets.views.manage', 'tickets.views.manage_shared')
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'tickets.views.manage'),
      ('OWNER', 'tickets.views.manage_shared'),
      ('ADMIN', 'tickets.views.manage'),
      ('ADMIN', 'tickets.views.manage_shared'),
      ('MANAGER', 'tickets.views.manage')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", ticket_view_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN ticket_view_permissions ON ticket_view_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
