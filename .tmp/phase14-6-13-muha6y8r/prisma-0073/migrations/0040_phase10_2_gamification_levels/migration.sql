CREATE TABLE "gamification_levels" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "normalized_name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "level_number" INTEGER NOT NULL,
  "xp_threshold" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_levels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_levels_name_nonblank" CHECK (btrim("name") <> ''),
  CONSTRAINT "gamification_levels_normalized_name_nonblank" CHECK (btrim("normalized_name") <> ''),
  CONSTRAINT "gamification_levels_description_nonblank" CHECK ("description" IS NULL OR btrim("description") <> ''),
  CONSTRAINT "gamification_levels_number_positive" CHECK ("level_number" > 0),
  CONSTRAINT "gamification_levels_threshold_bound" CHECK ("xp_threshold" BETWEEN 0 AND 1000000000)
);

CREATE UNIQUE INDEX "gamification_levels_workspace_level_number_key"
  ON "gamification_levels" ("workspace_id", "level_number");
CREATE UNIQUE INDEX "gamification_levels_workspace_normalized_name_key"
  ON "gamification_levels" ("workspace_id", "normalized_name");
CREATE INDEX "gamification_levels_workspace_active_level_idx"
  ON "gamification_levels" ("workspace_id", "is_active", "level_number");
CREATE INDEX "gamification_levels_workspace_threshold_idx"
  ON "gamification_levels" ("workspace_id", "xp_threshold");

ALTER TABLE "gamification_levels"
  ADD CONSTRAINT "gamification_levels_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES ('gamification.levels.manage', 'gamification.levels.manage permission')
ON CONFLICT ("key") DO NOTHING;

WITH gamification_level_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" = 'gamification.levels.manage'
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'gamification.levels.manage'),
      ('ADMIN', 'gamification.levels.manage'),
      ('MANAGER', 'gamification.levels.manage')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", gamification_level_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN gamification_level_permissions ON gamification_level_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'::"RoleScope"
  AND roles."is_system" = true
  AND roles."workspace_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
