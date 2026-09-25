CREATE TYPE "TicketConversationEntryType" AS ENUM ('PUBLIC_REPLY', 'INTERNAL_NOTE');

CREATE TABLE "ticket_conversation_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "ticket_id" UUID NOT NULL,
  "type" "TicketConversationEntryType" NOT NULL,
  "body" VARCHAR(12000) NOT NULL,
  "author_membership_id" UUID NOT NULL,
  "author_user_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_conversation_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_conversation_entries_body_nonblank_check" CHECK (length(btrim("body")) > 0)
);

CREATE UNIQUE INDEX "ticket_conversation_entries_id_workspace_id_key"
  ON "ticket_conversation_entries"("id", "workspace_id");

CREATE INDEX "ticket_conversation_entries_workspace_id_ticket_id_created_at_id_idx"
  ON "ticket_conversation_entries"("workspace_id", "ticket_id", "created_at", "id");

CREATE INDEX "ticket_conversation_entries_workspace_id_author_membership_id_created_at_idx"
  ON "ticket_conversation_entries"("workspace_id", "author_membership_id", "created_at");

ALTER TABLE "ticket_conversation_entries"
  ADD CONSTRAINT "ticket_conversation_entries_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_conversation_entries"
  ADD CONSTRAINT "ticket_conversation_entries_ticket_id_workspace_id_fkey"
  FOREIGN KEY ("ticket_id", "workspace_id") REFERENCES "tickets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_conversation_entries"
  ADD CONSTRAINT "ticket_conversation_entries_author_membership_id_workspace_id_fkey"
  FOREIGN KEY ("author_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_conversation_entries"
  ADD CONSTRAINT "ticket_conversation_entries_author_user_id_fkey"
  FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('tickets.reply', 'tickets.reply permission'),
  ('tickets.notes.view', 'tickets.notes.view permission'),
  ('tickets.notes.create', 'tickets.notes.create permission')
ON CONFLICT ("key") DO NOTHING;

WITH ticket_conversation_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('tickets.reply', 'tickets.notes.view', 'tickets.notes.create')
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'tickets.reply'),
      ('OWNER', 'tickets.notes.view'),
      ('OWNER', 'tickets.notes.create'),
      ('ADMIN', 'tickets.reply'),
      ('ADMIN', 'tickets.notes.view'),
      ('ADMIN', 'tickets.notes.create'),
      ('MANAGER', 'tickets.reply'),
      ('MANAGER', 'tickets.notes.view'),
      ('MANAGER', 'tickets.notes.create')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", ticket_conversation_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN ticket_conversation_permissions ON ticket_conversation_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'::"RoleScope"
  AND roles."is_system" = true
  AND roles."workspace_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
