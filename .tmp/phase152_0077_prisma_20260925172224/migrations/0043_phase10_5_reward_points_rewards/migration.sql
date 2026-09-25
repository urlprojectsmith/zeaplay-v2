CREATE TYPE "GamificationRewardPointEntryType" AS ENUM ('EARN', 'SPEND', 'REFUND', 'ADJUSTMENT', 'REVERSAL');
CREATE TYPE "GamificationRewardPointSourceType" AS ENUM ('ACHIEVEMENT', 'STREAK', 'REWARD_REDEMPTION', 'MANUAL', 'SYSTEM');
CREATE TYPE "GamificationRewardInventoryMode" AS ENUM ('UNLIMITED', 'LIMITED');
CREATE TYPE "GamificationRewardRedemptionStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELLED');

ALTER TABLE "gamification_achievement_definitions"
  ADD COLUMN "reward_points_reward" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "gamification_achievement_awards"
  ADD COLUMN "reward_points_reward_snapshot" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "gamification_streak_configs"
  ADD COLUMN "daily_reward_points" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "gamification_streak_days"
  ADD COLUMN "daily_reward_points_snapshot" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "gamification_achievement_definitions"
  ADD CONSTRAINT "gamification_achievement_definitions_reward_points_bound"
  CHECK ("reward_points_reward" BETWEEN 0 AND 100000);

ALTER TABLE "gamification_achievement_awards"
  ADD CONSTRAINT "gamification_achievement_awards_reward_points_bound"
  CHECK ("reward_points_reward_snapshot" BETWEEN 0 AND 100000);

ALTER TABLE "gamification_streak_configs"
  ADD CONSTRAINT "gamification_streak_configs_daily_reward_points_bound"
  CHECK ("daily_reward_points" BETWEEN 0 AND 100000);

ALTER TABLE "gamification_streak_days"
  ADD CONSTRAINT "gamification_streak_days_daily_reward_points_bound"
  CHECK ("daily_reward_points_snapshot" BETWEEN 0 AND 100000);

CREATE TABLE "gamification_reward_point_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  "entry_type" "GamificationRewardPointEntryType" NOT NULL,
  "source_type" "GamificationRewardPointSourceType" NOT NULL,
  "source_event" VARCHAR(80) NOT NULL,
  "source_entity_id" UUID,
  "idempotency_key" VARCHAR(160),
  "reversal_of_entry_id" UUID,
  "actor_membership_id" UUID,
  "reason" VARCHAR(500),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gamification_reward_point_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_reward_point_entries_amount_nonzero_bound" CHECK ("amount" <> 0 AND abs("amount") <= 1000000),
  CONSTRAINT "gamification_reward_point_entries_amount_semantics" CHECK (
    ("entry_type" IN ('EARN', 'REFUND') AND "amount" > 0)
    OR ("entry_type" = 'SPEND' AND "amount" < 0)
    OR ("entry_type" IN ('ADJUSTMENT', 'REVERSAL') AND "amount" <> 0)
  )
);

CREATE TABLE "gamification_reward_definitions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "normalized_name" VARCHAR(80) NOT NULL,
  "description" VARCHAR(500),
  "points_cost" INTEGER NOT NULL,
  "inventory_mode" "GamificationRewardInventoryMode" NOT NULL,
  "available_quantity" INTEGER,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gamification_reward_definitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_reward_definitions_name_nonblank" CHECK (btrim("name") <> ''),
  CONSTRAINT "gamification_reward_definitions_cost_bound" CHECK ("points_cost" BETWEEN 1 AND 1000000),
  CONSTRAINT "gamification_reward_definitions_inventory_shape" CHECK (
    ("inventory_mode" = 'UNLIMITED' AND "available_quantity" IS NULL)
    OR ("inventory_mode" = 'LIMITED' AND "available_quantity" IS NOT NULL AND "available_quantity" BETWEEN 0 AND 1000000)
  )
);

CREATE TABLE "gamification_reward_redemptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "reward_definition_id" UUID NOT NULL,
  "status" "GamificationRewardRedemptionStatus" NOT NULL DEFAULT 'PENDING',
  "reward_name_snapshot" VARCHAR(80) NOT NULL,
  "points_cost_snapshot" INTEGER NOT NULL,
  "inventory_mode_snapshot" "GamificationRewardInventoryMode" NOT NULL,
  "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fulfilled_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "fulfilled_by_membership_id" UUID,
  "cancelled_by_membership_id" UUID,
  "cancel_reason" VARCHAR(500),
  "idempotency_key" VARCHAR(160) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gamification_reward_redemptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_reward_redemptions_cost_bound" CHECK ("points_cost_snapshot" BETWEEN 1 AND 1000000),
  CONSTRAINT "gamification_reward_redemptions_status_shape" CHECK (
    ("status" = 'PENDING' AND "fulfilled_at" IS NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'FULFILLED' AND "fulfilled_at" IS NOT NULL AND "cancelled_at" IS NULL)
    OR ("status" = 'CANCELLED' AND "cancelled_at" IS NOT NULL AND "fulfilled_at" IS NULL)
  )
);

CREATE UNIQUE INDEX "gamification_reward_point_entries_id_workspace_key"
  ON "gamification_reward_point_entries" ("id", "workspace_id");
CREATE UNIQUE INDEX "gamification_reward_point_entries_idempotency_key"
  ON "gamification_reward_point_entries" ("workspace_id", "membership_id", "idempotency_key");
CREATE UNIQUE INDEX "gamification_reward_point_entries_reversal_once_key"
  ON "gamification_reward_point_entries" ("reversal_of_entry_id")
  WHERE "reversal_of_entry_id" IS NOT NULL;
CREATE INDEX "gamification_reward_point_entries_member_created_idx"
  ON "gamification_reward_point_entries" ("workspace_id", "membership_id", "created_at", "id");
CREATE INDEX "gamification_reward_point_entries_member_idx"
  ON "gamification_reward_point_entries" ("workspace_id", "membership_id");
CREATE INDEX "gamification_reward_point_entries_source_idx"
  ON "gamification_reward_point_entries" ("workspace_id", "source_type", "source_event");
CREATE INDEX "gamification_reward_point_entries_actor_idx"
  ON "gamification_reward_point_entries" ("actor_membership_id", "workspace_id");

CREATE UNIQUE INDEX "gamification_reward_definitions_id_workspace_key"
  ON "gamification_reward_definitions" ("id", "workspace_id");
CREATE UNIQUE INDEX "gamification_reward_definitions_workspace_name_key"
  ON "gamification_reward_definitions" ("workspace_id", "normalized_name");
CREATE INDEX "gamification_reward_definitions_workspace_active_name_idx"
  ON "gamification_reward_definitions" ("workspace_id", "is_active", "name");

CREATE UNIQUE INDEX "gamification_reward_redemptions_id_workspace_key"
  ON "gamification_reward_redemptions" ("id", "workspace_id");
CREATE UNIQUE INDEX "gamification_reward_redemptions_idempotency_key"
  ON "gamification_reward_redemptions" ("workspace_id", "membership_id", "idempotency_key");
CREATE INDEX "gamification_reward_redemptions_member_requested_idx"
  ON "gamification_reward_redemptions" ("workspace_id", "membership_id", "requested_at", "id");
CREATE INDEX "gamification_reward_redemptions_status_requested_idx"
  ON "gamification_reward_redemptions" ("workspace_id", "status", "requested_at", "id");
CREATE INDEX "gamification_reward_redemptions_reward_status_idx"
  ON "gamification_reward_redemptions" ("workspace_id", "reward_definition_id", "status");

ALTER TABLE "gamification_reward_point_entries"
  ADD CONSTRAINT "gamification_reward_point_entries_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gamification_reward_point_entries"
  ADD CONSTRAINT "gamification_reward_point_entries_membership_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gamification_reward_point_entries"
  ADD CONSTRAINT "gamification_reward_point_entries_actor_fkey"
  FOREIGN KEY ("actor_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gamification_reward_point_entries"
  ADD CONSTRAINT "gamification_reward_point_entries_reversal_fkey"
  FOREIGN KEY ("reversal_of_entry_id") REFERENCES "gamification_reward_point_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_reward_definitions"
  ADD CONSTRAINT "gamification_reward_definitions_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_reward_redemptions"
  ADD CONSTRAINT "gamification_reward_redemptions_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gamification_reward_redemptions"
  ADD CONSTRAINT "gamification_reward_redemptions_membership_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gamification_reward_redemptions"
  ADD CONSTRAINT "gamification_reward_redemptions_reward_fkey"
  FOREIGN KEY ("reward_definition_id", "workspace_id") REFERENCES "gamification_reward_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gamification_reward_redemptions"
  ADD CONSTRAINT "gamification_reward_redemptions_fulfilled_by_fkey"
  FOREIGN KEY ("fulfilled_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gamification_reward_redemptions"
  ADD CONSTRAINT "gamification_reward_redemptions_cancelled_by_fkey"
  FOREIGN KEY ("cancelled_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_gamification_reward_point_entry_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'gamification_reward_point_entries are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gamification_reward_point_entries_prevent_update"
BEFORE UPDATE ON "gamification_reward_point_entries"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_reward_point_entry_mutation"();

CREATE TRIGGER "gamification_reward_point_entries_prevent_delete"
BEFORE DELETE ON "gamification_reward_point_entries"
FOR EACH ROW
EXECUTE FUNCTION "prevent_gamification_reward_point_entry_mutation"();

INSERT INTO "permissions" ("key", "description")
VALUES
  ('gamification.rewards.redeem', 'gamification.rewards.redeem permission'),
  ('gamification.rewards.manage', 'gamification.rewards.manage permission')
ON CONFLICT ("key") DO NOTHING;

WITH reward_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('gamification.rewards.redeem', 'gamification.rewards.manage')
),
system_role_permission_keys("role_key", "permission_key") AS (
  VALUES
    ('OWNER', 'gamification.rewards.redeem'),
    ('ADMIN', 'gamification.rewards.redeem'),
    ('MANAGER', 'gamification.rewards.redeem'),
    ('MEMBER', 'gamification.rewards.redeem'),
    ('OWNER', 'gamification.rewards.manage'),
    ('ADMIN', 'gamification.rewards.manage'),
    ('MANAGER', 'gamification.rewards.manage')
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", reward_permissions."id"
FROM system_role_permission_keys
JOIN "roles" ON roles."key" = system_role_permission_keys."role_key"
JOIN reward_permissions ON reward_permissions."key" = system_role_permission_keys."permission_key"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
