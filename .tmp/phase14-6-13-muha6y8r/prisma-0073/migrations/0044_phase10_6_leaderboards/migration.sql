CREATE TYPE "GamificationLeaderboardPrivacyMode" AS ENUM (
  'SHOW_NAME',
  'SHOW_DISPLAY_NAME',
  'ANONYMOUS',
  'OPT_OUT'
);

CREATE TABLE "gamification_leaderboard_configs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "workspace_leaderboard_enabled" BOOLEAN NOT NULL DEFAULT false,
  "department_leaderboard_enabled" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gamification_leaderboard_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gamification_leaderboard_preferences" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "privacy_mode" "GamificationLeaderboardPrivacyMode" NOT NULL DEFAULT 'ANONYMOUS',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gamification_leaderboard_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gamification_leaderboard_configs_workspace_id_key"
  ON "gamification_leaderboard_configs"("workspace_id");

CREATE INDEX "gamification_leaderboard_configs_enabled_idx"
  ON "gamification_leaderboard_configs"("workspace_id", "enabled");

CREATE UNIQUE INDEX "gamification_leaderboard_preferences_workspace_id_membership_id_key"
  ON "gamification_leaderboard_preferences"("workspace_id", "membership_id");

CREATE UNIQUE INDEX "gamification_leaderboard_preferences_membership_workspace_key"
  ON "gamification_leaderboard_preferences"("membership_id", "workspace_id");

CREATE INDEX "gamification_leaderboard_preferences_privacy_idx"
  ON "gamification_leaderboard_preferences"("workspace_id", "privacy_mode");

ALTER TABLE "gamification_leaderboard_configs"
  ADD CONSTRAINT "gamification_leaderboard_configs_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_leaderboard_preferences"
  ADD CONSTRAINT "gamification_leaderboard_preferences_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_leaderboard_preferences"
  ADD CONSTRAINT "gamification_leaderboard_preferences_membership_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('gamification.leaderboards.view', 'gamification.leaderboards.view permission'),
  ('gamification.leaderboards.manage', 'gamification.leaderboards.manage permission')
ON CONFLICT ("key") DO NOTHING;

WITH permission_ids AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('gamification.leaderboards.view', 'gamification.leaderboards.manage')
),
system_role_permissions AS (
  SELECT roles."id" AS "role_id", permission_ids."id" AS "permission_id"
  FROM "roles"
  JOIN (
    VALUES
      ('OWNER', 'gamification.leaderboards.view'),
      ('ADMIN', 'gamification.leaderboards.view'),
      ('MANAGER', 'gamification.leaderboards.view'),
      ('MEMBER', 'gamification.leaderboards.view'),
      ('OWNER', 'gamification.leaderboards.manage'),
      ('ADMIN', 'gamification.leaderboards.manage'),
      ('MANAGER', 'gamification.leaderboards.manage')
  ) AS grants("role_key", "permission_key")
    ON grants."role_key" = roles."key"
  JOIN permission_ids
    ON permission_ids."key" = grants."permission_key"
  WHERE roles."scope" = 'WORKSPACE'
    AND roles."workspace_id" IS NULL
    AND roles."is_system" = true
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "role_id", "permission_id"
FROM system_role_permissions
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
