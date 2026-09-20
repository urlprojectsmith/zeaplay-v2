CREATE TABLE "ticket_attachments" (
  "workspace_id" UUID NOT NULL,
  "ticket_id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "attached_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removed_at" TIMESTAMPTZ(6),

  CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("ticket_id", "attachment_id")
);

CREATE TABLE "ticket_conversation_attachments" (
  "workspace_id" UUID NOT NULL,
  "conversation_entry_id" UUID NOT NULL,
  "attachment_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ticket_conversation_attachments_pkey" PRIMARY KEY ("conversation_entry_id", "attachment_id")
);

CREATE INDEX "ticket_attachments_workspace_id_ticket_id_removed_at_created_at_idx"
  ON "ticket_attachments"("workspace_id", "ticket_id", "removed_at", "created_at");

CREATE INDEX "ticket_attachments_workspace_id_attachment_id_removed_at_idx"
  ON "ticket_attachments"("workspace_id", "attachment_id", "removed_at");

CREATE INDEX "ticket_conversation_attachments_workspace_id_conversation_entry_id_created_at_idx"
  ON "ticket_conversation_attachments"("workspace_id", "conversation_entry_id", "created_at");

CREATE INDEX "ticket_conversation_attachments_workspace_id_attachment_id_idx"
  ON "ticket_conversation_attachments"("workspace_id", "attachment_id");

ALTER TABLE "ticket_attachments"
  ADD CONSTRAINT "ticket_attachments_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ticket_attachments_ticket_id_workspace_id_fkey"
  FOREIGN KEY ("ticket_id", "workspace_id") REFERENCES "tickets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ticket_attachments_attachment_id_workspace_id_fkey"
  FOREIGN KEY ("attachment_id", "workspace_id") REFERENCES "attachments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ticket_attachments_attached_by_id_fkey"
  FOREIGN KEY ("attached_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_conversation_attachments"
  ADD CONSTRAINT "ticket_conversation_attachments_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ticket_conversation_attachments_conversation_entry_id_workspace_id_fkey"
  FOREIGN KEY ("conversation_entry_id", "workspace_id") REFERENCES "ticket_conversation_entries"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ticket_conversation_attachments_attachment_id_workspace_id_fkey"
  FOREIGN KEY ("attachment_id", "workspace_id") REFERENCES "attachments"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('tickets.attachments.view', 'tickets.attachments.view permission'),
  ('tickets.attachments.add', 'tickets.attachments.add permission'),
  ('tickets.attachments.remove', 'tickets.attachments.remove permission'),
  ('tickets.activity.view', 'tickets.activity.view permission')
ON CONFLICT ("key") DO NOTHING;

WITH ticket_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN (
    'tickets.attachments.view',
    'tickets.attachments.add',
    'tickets.attachments.remove',
    'tickets.activity.view'
  )
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'tickets.attachments.view'),
      ('OWNER', 'tickets.attachments.add'),
      ('OWNER', 'tickets.attachments.remove'),
      ('OWNER', 'tickets.activity.view'),
      ('ADMIN', 'tickets.attachments.view'),
      ('ADMIN', 'tickets.attachments.add'),
      ('ADMIN', 'tickets.attachments.remove'),
      ('ADMIN', 'tickets.activity.view'),
      ('MANAGER', 'tickets.attachments.view'),
      ('MANAGER', 'tickets.attachments.add'),
      ('MANAGER', 'tickets.attachments.remove'),
      ('MANAGER', 'tickets.activity.view'),
      ('MEMBER', 'tickets.attachments.view'),
      ('MEMBER', 'tickets.attachments.add'),
      ('MEMBER', 'tickets.activity.view')
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
