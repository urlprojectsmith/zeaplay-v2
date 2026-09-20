CREATE TYPE "TicketEscalationLevel" AS ENUM ('NONE', 'LEVEL_1', 'LEVEL_2', 'LEVEL_3');

ALTER TABLE "tickets"
  ADD COLUMN "escalation_level" "TicketEscalationLevel" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "escalation_changed_at" TIMESTAMPTZ(6),
  ADD COLUMN "escalation_changed_by_membership_id" UUID,
  ADD COLUMN "escalation_last_reason" VARCHAR(500);

CREATE INDEX "tickets_workspace_id_escalation_level_deleted_at_idx"
  ON "tickets"("workspace_id", "escalation_level", "deleted_at");

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_escalation_changed_by_membership_id_workspace_id_fkey"
  FOREIGN KEY ("escalation_changed_by_membership_id", "workspace_id")
  REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('tickets.claim', 'tickets.claim permission'),
  ('tickets.escalate', 'tickets.escalate permission')
ON CONFLICT ("key") DO NOTHING;

WITH ticket_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('tickets.claim', 'tickets.escalate')
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'tickets.claim'),
      ('OWNER', 'tickets.escalate'),
      ('ADMIN', 'tickets.claim'),
      ('ADMIN', 'tickets.escalate'),
      ('MANAGER', 'tickets.claim'),
      ('MANAGER', 'tickets.escalate'),
      ('MEMBER', 'tickets.claim')
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
