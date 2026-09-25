CREATE TYPE "SecurityStepUpPurpose" AS ENUM ('GAMIFICATION_RESET');
CREATE TYPE "GamificationAdminEconomy" AS ENUM ('XP', 'REWARD_POINTS');

CREATE TABLE "security_step_up_grants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "refresh_token_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "target_membership_id" UUID NOT NULL,
  "purpose" "SecurityStepUpPurpose" NOT NULL,
  "economy" "GamificationAdminEconomy" NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_step_up_grants_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "security_step_up_grants_expiry_after_created"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "security_step_up_grants_used_after_created"
    CHECK ("used_at" IS NULL OR "used_at" >= "created_at")
);

CREATE INDEX "security_step_up_grants_user_session_expiry_idx"
  ON "security_step_up_grants" ("user_id", "refresh_token_id", "expires_at");
CREATE INDEX "security_step_up_grants_target_idx"
  ON "security_step_up_grants" ("workspace_id", "target_membership_id", "purpose", "economy");
CREATE INDEX "security_step_up_grants_used_expiry_idx"
  ON "security_step_up_grants" ("used_at", "expires_at");

ALTER TABLE "security_step_up_grants"
  ADD CONSTRAINT "security_step_up_grants_user_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_step_up_grants"
  ADD CONSTRAINT "security_step_up_grants_refresh_token_fkey"
  FOREIGN KEY ("refresh_token_id") REFERENCES "refresh_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_step_up_grants"
  ADD CONSTRAINT "security_step_up_grants_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_step_up_grants"
  ADD CONSTRAINT "security_step_up_grants_target_membership_fkey"
  FOREIGN KEY ("target_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('gamification.adjustments.manage', 'gamification.adjustments.manage permission'),
  ('gamification.reset', 'gamification.reset permission')
ON CONFLICT ("key") DO NOTHING;

WITH gamification_admin_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('gamification.adjustments.manage', 'gamification.reset')
),
system_role_permission_keys("role_key", "permission_key") AS (
  VALUES
    ('OWNER', 'gamification.adjustments.manage'),
    ('ADMIN', 'gamification.adjustments.manage'),
    ('MANAGER', 'gamification.adjustments.manage'),
    ('OWNER', 'gamification.reset'),
    ('ADMIN', 'gamification.reset')
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", gamification_admin_permissions."id"
FROM system_role_permission_keys
JOIN "roles" ON roles."key" = system_role_permission_keys."role_key"
JOIN gamification_admin_permissions
  ON gamification_admin_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'
  AND roles."workspace_id" IS NULL
  AND roles."is_system" = true
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
