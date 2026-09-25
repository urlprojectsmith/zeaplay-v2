CREATE TYPE "GamificationStreakQualificationType" AS ENUM (
  'TASK_COMPLETED',
  'TICKET_RESOLVED'
);

CREATE TABLE "gamification_streak_configs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "daily_xp_reward" INTEGER NOT NULL DEFAULT 0,
  "enabled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_streak_configs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_streak_configs_daily_xp_reward_bound" CHECK ("daily_xp_reward" BETWEEN 0 AND 100000),
  CONSTRAINT "gamification_streak_configs_enabled_at_required" CHECK ("enabled" = false OR "enabled_at" IS NOT NULL)
);

CREATE TABLE "gamification_streak_days" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "local_date" DATE NOT NULL,
  "qualification_type" "GamificationStreakQualificationType" NOT NULL,
  "source_entity_id" UUID NOT NULL,
  "qualified_at" TIMESTAMPTZ(6) NOT NULL,
  "timezone_snapshot" VARCHAR(80) NOT NULL,
  "daily_xp_reward_snapshot" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_streak_days_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_streak_days_timezone_snapshot_nonblank" CHECK (btrim("timezone_snapshot") <> ''),
  CONSTRAINT "gamification_streak_days_daily_xp_reward_bound" CHECK ("daily_xp_reward_snapshot" BETWEEN 0 AND 100000)
);

CREATE UNIQUE INDEX "gamification_streak_configs_workspace_key"
  ON "gamification_streak_configs" ("workspace_id");
CREATE INDEX "gamification_streak_configs_workspace_enabled_idx"
  ON "gamification_streak_configs" ("workspace_id", "enabled");

CREATE UNIQUE INDEX "gamification_streak_days_id_workspace_key"
  ON "gamification_streak_days" ("id", "workspace_id");
CREATE UNIQUE INDEX "gamification_streak_days_member_date_key"
  ON "gamification_streak_days" ("workspace_id", "membership_id", "local_date");
CREATE UNIQUE INDEX "gamification_streak_days_member_source_key"
  ON "gamification_streak_days" ("workspace_id", "membership_id", "qualification_type", "source_entity_id");
CREATE INDEX "gamification_streak_days_member_local_date_idx"
  ON "gamification_streak_days" ("workspace_id", "membership_id", "local_date", "id");
CREATE INDEX "gamification_streak_days_member_qualified_at_idx"
  ON "gamification_streak_days" ("workspace_id", "membership_id", "qualified_at", "id");

ALTER TABLE "gamification_streak_configs"
  ADD CONSTRAINT "gamification_streak_configs_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_streak_days"
  ADD CONSTRAINT "gamification_streak_days_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_streak_days"
  ADD CONSTRAINT "gamification_streak_days_membership_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_gamification_streak_day_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gamification streak days are immutable'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gamification_streak_days_prevent_update"
BEFORE UPDATE ON "gamification_streak_days"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_streak_day_mutation"();

CREATE TRIGGER "gamification_streak_days_prevent_delete"
BEFORE DELETE ON "gamification_streak_days"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_streak_day_mutation"();

INSERT INTO "permissions" ("key", "description")
VALUES ('gamification.streaks.manage', 'gamification.streaks.manage permission')
ON CONFLICT ("key") DO NOTHING;

WITH gamification_streak_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" = 'gamification.streaks.manage'
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'gamification.streaks.manage'),
      ('ADMIN', 'gamification.streaks.manage'),
      ('MANAGER', 'gamification.streaks.manage')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", gamification_streak_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN gamification_streak_permissions ON gamification_streak_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'::"RoleScope"
  AND roles."is_system" = true
  AND roles."workspace_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
