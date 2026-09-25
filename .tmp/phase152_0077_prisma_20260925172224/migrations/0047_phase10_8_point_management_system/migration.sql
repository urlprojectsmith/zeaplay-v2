CREATE TYPE "ProjectXpCategory" AS ENUM ('HIGH', 'MEDIUM', 'LONG_TERM');
CREATE TYPE "GamificationPointScopeType" AS ENUM ('WORKSPACE', 'DEPARTMENT');
CREATE TYPE "GamificationPointWorkType" AS ENUM ('TASK', 'PROJECT', 'TICKET');
CREATE TYPE "GamificationPointCategory" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT', 'LONG_TERM');

ALTER TABLE "projects"
  ADD COLUMN "xp_category" "ProjectXpCategory";

CREATE INDEX "projects_workspace_xp_category_idx"
  ON "projects" ("workspace_id", "xp_category");

CREATE TABLE "gamification_point_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "department_id" UUID,
  "scope_type" "GamificationPointScopeType" NOT NULL,
  "work_type" "GamificationPointWorkType" NOT NULL,
  "category" "GamificationPointCategory" NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "base_xp" INTEGER NOT NULL,
  "early_bonus_xp" INTEGER NOT NULL DEFAULT 0,
  "early_threshold_minutes" INTEGER,
  "late_penalty_percent" INTEGER NOT NULL DEFAULT 0,
  "penalty_interval_minutes" INTEGER,
  "max_penalty_xp" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "gamification_point_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_point_rules_scope_department_check"
    CHECK (
      ("scope_type" = 'WORKSPACE' AND "department_id" IS NULL)
      OR ("scope_type" = 'DEPARTMENT' AND "department_id" IS NOT NULL)
    ),
  CONSTRAINT "gamification_point_rules_category_check"
    CHECK (
      ("work_type" IN ('TASK', 'TICKET') AND "category" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT'))
      OR ("work_type" = 'PROJECT' AND "category" IN ('HIGH', 'MEDIUM', 'LONG_TERM'))
    ),
  CONSTRAINT "gamification_point_rules_base_xp_check"
    CHECK ("base_xp" >= 0 AND "base_xp" <= 1000000 AND ("is_enabled" = false OR "base_xp" > 0)),
  CONSTRAINT "gamification_point_rules_early_bonus_check"
    CHECK (
      "early_bonus_xp" >= 0
      AND "early_bonus_xp" <= 1000000
      AND ("early_bonus_xp" = 0 OR COALESCE("early_threshold_minutes", 0) > 0)
    ),
  CONSTRAINT "gamification_point_rules_late_penalty_check"
    CHECK (
      "late_penalty_percent" >= 0
      AND "late_penalty_percent" <= 100
      AND (
        ("late_penalty_percent" = 0 AND "max_penalty_xp" = 0)
        OR (
          "late_penalty_percent" > 0
          AND COALESCE("penalty_interval_minutes", 0) > 0
          AND "max_penalty_xp" > 0
        )
      )
    ),
  CONSTRAINT "gamification_point_rules_max_penalty_check"
    CHECK ("max_penalty_xp" >= 0 AND "max_penalty_xp" <= "base_xp")
);

CREATE UNIQUE INDEX "gamification_point_rules_workspace_default_unique"
  ON "gamification_point_rules" ("workspace_id", "work_type", "category")
  WHERE "scope_type" = 'WORKSPACE' AND "department_id" IS NULL;

CREATE UNIQUE INDEX "gamification_point_rules_department_override_unique"
  ON "gamification_point_rules" ("workspace_id", "department_id", "work_type", "category")
  WHERE "scope_type" = 'DEPARTMENT' AND "department_id" IS NOT NULL;

CREATE INDEX "gamification_point_rules_workspace_key_idx"
  ON "gamification_point_rules" ("workspace_id", "work_type", "category");

CREATE INDEX "gamification_point_rules_department_key_idx"
  ON "gamification_point_rules" ("workspace_id", "department_id", "work_type", "category");

CREATE TABLE "gamification_creation_point_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "department_id" UUID,
  "scope_type" "GamificationPointScopeType" NOT NULL,
  "work_type" "GamificationPointWorkType" NOT NULL,
  "category" "GamificationPointCategory" NOT NULL,
  "role_id" UUID NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "creation_xp" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "gamification_creation_point_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_creation_point_rules_scope_department_check"
    CHECK (
      ("scope_type" = 'WORKSPACE' AND "department_id" IS NULL)
      OR ("scope_type" = 'DEPARTMENT' AND "department_id" IS NOT NULL)
    ),
  CONSTRAINT "gamification_creation_point_rules_category_check"
    CHECK (
      ("work_type" IN ('TASK', 'TICKET') AND "category" IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT'))
      OR ("work_type" = 'PROJECT' AND "category" IN ('HIGH', 'MEDIUM', 'LONG_TERM'))
    ),
  CONSTRAINT "gamification_creation_point_rules_creation_xp_check"
    CHECK ("creation_xp" >= 0 AND "creation_xp" <= 1000000)
);

CREATE UNIQUE INDEX "gamification_creation_point_rules_workspace_default_unique"
  ON "gamification_creation_point_rules" ("workspace_id", "work_type", "category", "role_id")
  WHERE "scope_type" = 'WORKSPACE' AND "department_id" IS NULL;

CREATE UNIQUE INDEX "gamification_creation_point_rules_department_override_unique"
  ON "gamification_creation_point_rules" (
    "workspace_id",
    "department_id",
    "work_type",
    "category",
    "role_id"
  )
  WHERE "scope_type" = 'DEPARTMENT' AND "department_id" IS NOT NULL;

CREATE INDEX "gamification_creation_point_rules_workspace_key_idx"
  ON "gamification_creation_point_rules" ("workspace_id", "work_type", "category", "role_id");

CREATE INDEX "gamification_creation_point_rules_department_key_idx"
  ON "gamification_creation_point_rules" (
    "workspace_id",
    "department_id",
    "work_type",
    "category",
    "role_id"
  );

CREATE INDEX "gamification_creation_point_rules_role_idx"
  ON "gamification_creation_point_rules" ("workspace_id", "role_id");

ALTER TABLE "gamification_point_rules"
  ADD CONSTRAINT "gamification_point_rules_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_point_rules"
  ADD CONSTRAINT "gamification_point_rules_department_id_workspace_id_fkey"
  FOREIGN KEY ("department_id", "workspace_id") REFERENCES "departments"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gamification_creation_point_rules"
  ADD CONSTRAINT "gamification_creation_point_rules_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_creation_point_rules"
  ADD CONSTRAINT "gamification_creation_point_rules_department_id_workspace_id_fkey"
  FOREIGN KEY ("department_id", "workspace_id") REFERENCES "departments"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gamification_creation_point_rules"
  ADD CONSTRAINT "gamification_creation_point_rules_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('gamification.points.view', 'gamification.points.view permission'),
  ('gamification.points.manage_workspace', 'gamification.points.manage_workspace permission'),
  ('gamification.points.manage_department', 'gamification.points.manage_department permission')
ON CONFLICT ("key") DO NOTHING;

WITH point_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN (
    'gamification.points.view',
    'gamification.points.manage_workspace',
    'gamification.points.manage_department'
  )
),
system_role_permissions("role_key", "permission_key") AS (
  VALUES
    ('OWNER', 'gamification.points.view'),
    ('ADMIN', 'gamification.points.view'),
    ('MANAGER', 'gamification.points.view'),
    ('MEMBER', 'gamification.points.view'),
    ('OWNER', 'gamification.points.manage_workspace'),
    ('ADMIN', 'gamification.points.manage_workspace'),
    ('MANAGER', 'gamification.points.manage_department')
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", point_permissions."id"
FROM system_role_permissions
JOIN "roles" ON roles."key" = system_role_permissions."role_key"
JOIN point_permissions ON point_permissions."key" = system_role_permissions."permission_key"
WHERE roles."scope" = 'WORKSPACE'
  AND roles."workspace_id" IS NULL
  AND roles."is_system" = true
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
