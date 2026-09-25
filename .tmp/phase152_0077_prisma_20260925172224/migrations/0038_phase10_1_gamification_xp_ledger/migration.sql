CREATE TYPE "GamificationXpEntryType" AS ENUM ('EARN', 'DEDUCT', 'REVERSAL', 'ADJUSTMENT');
CREATE TYPE "GamificationXpSourceType" AS ENUM ('TASK', 'PROJECT', 'TICKET', 'STREAK', 'ACHIEVEMENT', 'MANUAL', 'SYSTEM');

CREATE TABLE "gamification_xp_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  "entry_type" "GamificationXpEntryType" NOT NULL,
  "source_type" "GamificationXpSourceType" NOT NULL,
  "source_event" VARCHAR(80) NOT NULL,
  "source_entity_id" UUID,
  "idempotency_key" VARCHAR(160),
  "reversal_of_entry_id" UUID,
  "actor_membership_id" UUID,
  "reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_xp_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_xp_entries_amount_nonzero" CHECK ("amount" <> 0),
  CONSTRAINT "gamification_xp_entries_amount_bound" CHECK ("amount" BETWEEN -1000000 AND 1000000),
  CONSTRAINT "gamification_xp_entries_type_amount_check" CHECK (
    ("entry_type" = 'EARN' AND "amount" > 0 AND "reversal_of_entry_id" IS NULL)
    OR ("entry_type" = 'DEDUCT' AND "amount" < 0 AND "reversal_of_entry_id" IS NULL)
    OR ("entry_type" = 'REVERSAL' AND "reversal_of_entry_id" IS NOT NULL)
    OR ("entry_type" = 'ADJUSTMENT' AND "reversal_of_entry_id" IS NULL)
  ),
  CONSTRAINT "gamification_xp_entries_source_event_nonblank" CHECK (btrim("source_event") <> ''),
  CONSTRAINT "gamification_xp_entries_idempotency_nonblank" CHECK ("idempotency_key" IS NULL OR btrim("idempotency_key") <> ''),
  CONSTRAINT "gamification_xp_entries_reason_nonblank" CHECK ("reason" IS NULL OR btrim("reason") <> '')
);

CREATE UNIQUE INDEX "gamification_xp_entries_id_workspace_key" ON "gamification_xp_entries" ("id", "workspace_id");
CREATE INDEX "gamification_xp_entries_workspace_member_created_idx" ON "gamification_xp_entries" ("workspace_id", "membership_id", "created_at", "id");
CREATE INDEX "gamification_xp_entries_workspace_member_idx" ON "gamification_xp_entries" ("workspace_id", "membership_id");
CREATE INDEX "gamification_xp_entries_source_idx" ON "gamification_xp_entries" ("workspace_id", "source_type", "source_event");
CREATE INDEX "gamification_xp_entries_actor_idx" ON "gamification_xp_entries" ("actor_membership_id", "workspace_id");
CREATE UNIQUE INDEX "gamification_xp_entries_idempotency_unique_idx"
  ON "gamification_xp_entries" ("workspace_id", "membership_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX "gamification_xp_entries_reversal_unique_idx"
  ON "gamification_xp_entries" ("reversal_of_entry_id")
  WHERE "reversal_of_entry_id" IS NOT NULL;

ALTER TABLE "gamification_xp_entries"
  ADD CONSTRAINT "gamification_xp_entries_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_xp_entries"
  ADD CONSTRAINT "gamification_xp_entries_membership_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_xp_entries"
  ADD CONSTRAINT "gamification_xp_entries_actor_membership_fkey"
  FOREIGN KEY ("actor_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_xp_entries"
  ADD CONSTRAINT "gamification_xp_entries_reversal_of_entry_fkey"
  FOREIGN KEY ("reversal_of_entry_id") REFERENCES "gamification_xp_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES ('gamification.view', 'gamification.view permission')
ON CONFLICT ("key") DO NOTHING;

WITH gamification_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" = 'gamification.view'
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'gamification.view'),
      ('ADMIN', 'gamification.view'),
      ('MANAGER', 'gamification.view'),
      ('MEMBER', 'gamification.view')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", gamification_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN gamification_permissions ON gamification_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'::"RoleScope"
  AND roles."is_system" = true
  AND roles."workspace_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
