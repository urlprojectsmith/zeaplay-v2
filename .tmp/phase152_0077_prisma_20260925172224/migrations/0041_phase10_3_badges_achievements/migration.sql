CREATE TYPE "GamificationAchievementCriterionType" AS ENUM (
  'XP_TOTAL_AT_LEAST',
  'TASK_COMPLETED_COUNT',
  'PROJECT_COMPLETED_COUNT',
  'TICKET_RESOLVED_COUNT'
);

CREATE TABLE "gamification_badge_definitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "normalized_name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "icon_key" VARCHAR(80),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_badge_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_badge_definitions_name_nonblank" CHECK (btrim("name") <> ''),
  CONSTRAINT "gamification_badge_definitions_normalized_name_nonblank" CHECK (btrim("normalized_name") <> ''),
  CONSTRAINT "gamification_badge_definitions_description_nonblank" CHECK ("description" IS NULL OR btrim("description") <> ''),
  CONSTRAINT "gamification_badge_definitions_icon_key_nonblank" CHECK ("icon_key" IS NULL OR btrim("icon_key") <> '')
);

CREATE TABLE "gamification_achievement_definitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "normalized_name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "criterion_type" "GamificationAchievementCriterionType" NOT NULL,
  "criterion_value" INTEGER NOT NULL,
  "badge_definition_id" UUID,
  "xp_reward" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_achievement_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_achievement_definitions_name_nonblank" CHECK (btrim("name") <> ''),
  CONSTRAINT "gamification_achievement_definitions_normalized_name_nonblank" CHECK (btrim("normalized_name") <> ''),
  CONSTRAINT "gamification_achievement_definitions_description_nonblank" CHECK ("description" IS NULL OR btrim("description") <> ''),
  CONSTRAINT "gamification_achievement_definitions_criterion_value_positive" CHECK ("criterion_value" BETWEEN 1 AND 1000000000),
  CONSTRAINT "gamification_achievement_definitions_xp_reward_bound" CHECK ("xp_reward" BETWEEN 0 AND 100000)
);

CREATE TABLE "gamification_achievement_awards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "achievement_definition_id" UUID NOT NULL,
  "achievement_name_snapshot" VARCHAR(80) NOT NULL,
  "criterion_type_snapshot" "GamificationAchievementCriterionType" NOT NULL,
  "criterion_value_snapshot" INTEGER NOT NULL,
  "badge_definition_id_snapshot" UUID,
  "xp_reward_snapshot" INTEGER NOT NULL DEFAULT 0,
  "source_event_id" VARCHAR(160),
  "earned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_achievement_awards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_achievement_awards_name_snapshot_nonblank" CHECK (btrim("achievement_name_snapshot") <> ''),
  CONSTRAINT "gamification_achievement_awards_criterion_value_positive" CHECK ("criterion_value_snapshot" BETWEEN 1 AND 1000000000),
  CONSTRAINT "gamification_achievement_awards_xp_reward_bound" CHECK ("xp_reward_snapshot" BETWEEN 0 AND 100000),
  CONSTRAINT "gamification_achievement_awards_source_event_nonblank" CHECK ("source_event_id" IS NULL OR btrim("source_event_id") <> '')
);

CREATE TABLE "gamification_badge_awards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "badge_definition_id" UUID NOT NULL,
  "achievement_award_id" UUID,
  "badge_name_snapshot" VARCHAR(80) NOT NULL,
  "badge_icon_key_snapshot" VARCHAR(80),
  "earned_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_badge_awards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_badge_awards_name_snapshot_nonblank" CHECK (btrim("badge_name_snapshot") <> ''),
  CONSTRAINT "gamification_badge_awards_icon_snapshot_nonblank" CHECK ("badge_icon_key_snapshot" IS NULL OR btrim("badge_icon_key_snapshot") <> '')
);

CREATE UNIQUE INDEX "gamification_badge_definitions_id_workspace_key"
  ON "gamification_badge_definitions" ("id", "workspace_id");
CREATE UNIQUE INDEX "gamification_badge_definitions_workspace_name_key"
  ON "gamification_badge_definitions" ("workspace_id", "normalized_name");
CREATE INDEX "gamification_badge_definitions_workspace_active_name_idx"
  ON "gamification_badge_definitions" ("workspace_id", "is_active", "name");

CREATE UNIQUE INDEX "gamification_achievement_definitions_id_workspace_key"
  ON "gamification_achievement_definitions" ("id", "workspace_id");
CREATE UNIQUE INDEX "gamification_achievement_definitions_workspace_name_key"
  ON "gamification_achievement_definitions" ("workspace_id", "normalized_name");
CREATE INDEX "gamification_achievement_definitions_workspace_criterion_active_idx"
  ON "gamification_achievement_definitions" ("workspace_id", "criterion_type", "is_active");
CREATE INDEX "gamification_achievement_definitions_workspace_badge_idx"
  ON "gamification_achievement_definitions" ("workspace_id", "badge_definition_id");

CREATE UNIQUE INDEX "gamification_achievement_awards_once_key"
  ON "gamification_achievement_awards" ("workspace_id", "membership_id", "achievement_definition_id");
CREATE INDEX "gamification_achievement_awards_member_earned_idx"
  ON "gamification_achievement_awards" ("workspace_id", "membership_id", "earned_at", "id");
CREATE INDEX "gamification_achievement_awards_definition_idx"
  ON "gamification_achievement_awards" ("workspace_id", "achievement_definition_id");

CREATE UNIQUE INDEX "gamification_badge_awards_once_key"
  ON "gamification_badge_awards" ("workspace_id", "membership_id", "badge_definition_id");
CREATE INDEX "gamification_badge_awards_member_earned_idx"
  ON "gamification_badge_awards" ("workspace_id", "membership_id", "earned_at", "id");
CREATE INDEX "gamification_badge_awards_definition_idx"
  ON "gamification_badge_awards" ("workspace_id", "badge_definition_id");
CREATE INDEX "gamification_badge_awards_achievement_award_idx"
  ON "gamification_badge_awards" ("achievement_award_id");

ALTER TABLE "gamification_badge_definitions"
  ADD CONSTRAINT "gamification_badge_definitions_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_achievement_definitions"
  ADD CONSTRAINT "gamification_achievement_definitions_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_achievement_definitions"
  ADD CONSTRAINT "gamification_achievement_definitions_badge_fkey"
  FOREIGN KEY ("badge_definition_id", "workspace_id") REFERENCES "gamification_badge_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_achievement_awards"
  ADD CONSTRAINT "gamification_achievement_awards_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_achievement_awards"
  ADD CONSTRAINT "gamification_achievement_awards_membership_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_achievement_awards"
  ADD CONSTRAINT "gamification_achievement_awards_definition_fkey"
  FOREIGN KEY ("achievement_definition_id", "workspace_id") REFERENCES "gamification_achievement_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_badge_awards"
  ADD CONSTRAINT "gamification_badge_awards_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_badge_awards"
  ADD CONSTRAINT "gamification_badge_awards_membership_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_badge_awards"
  ADD CONSTRAINT "gamification_badge_awards_definition_fkey"
  FOREIGN KEY ("badge_definition_id", "workspace_id") REFERENCES "gamification_badge_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_badge_awards"
  ADD CONSTRAINT "gamification_badge_awards_achievement_award_fkey"
  FOREIGN KEY ("achievement_award_id") REFERENCES "gamification_achievement_awards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_gamification_award_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gamification awards are immutable'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gamification_achievement_awards_prevent_update"
BEFORE UPDATE ON "gamification_achievement_awards"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_award_mutation"();

CREATE TRIGGER "gamification_achievement_awards_prevent_delete"
BEFORE DELETE ON "gamification_achievement_awards"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_award_mutation"();

CREATE TRIGGER "gamification_badge_awards_prevent_update"
BEFORE UPDATE ON "gamification_badge_awards"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_award_mutation"();

CREATE TRIGGER "gamification_badge_awards_prevent_delete"
BEFORE DELETE ON "gamification_badge_awards"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_award_mutation"();

INSERT INTO "permissions" ("key", "description")
VALUES ('gamification.achievements.manage', 'gamification.achievements.manage permission')
ON CONFLICT ("key") DO NOTHING;

WITH gamification_achievement_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" = 'gamification.achievements.manage'
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'gamification.achievements.manage'),
      ('ADMIN', 'gamification.achievements.manage'),
      ('MANAGER', 'gamification.achievements.manage')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", gamification_achievement_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN gamification_achievement_permissions ON gamification_achievement_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'::"RoleScope"
  AND roles."is_system" = true
  AND roles."workspace_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
