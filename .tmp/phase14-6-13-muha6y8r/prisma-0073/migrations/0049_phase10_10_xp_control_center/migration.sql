CREATE TYPE "GamificationXpReconciliationStatus" AS ENUM ('APPLIED', 'NO_CHANGE', 'FAILED');

CREATE TABLE "gamification_xp_reconciliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "claimed_xp_snapshot" INTEGER NOT NULL,
  "stored_xp_snapshot" INTEGER NOT NULL,
  "current_xp_before_snapshot" INTEGER NOT NULL,
  "delta_snapshot" INTEGER NOT NULL,
  "adjustment_amount" INTEGER NOT NULL,
  "current_xp_after_snapshot" INTEGER NOT NULL,
  "status" "GamificationXpReconciliationStatus" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "actor_membership_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "evidence_hash" VARCHAR(128),
  "analysis_version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gamification_xp_reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gamification_xp_reconciliations_reason_nonblank" CHECK (btrim("reason") <> ''),
  CONSTRAINT "gamification_xp_reconciliations_idempotency_nonblank" CHECK (btrim("idempotency_key") <> ''),
  CONSTRAINT "gamification_xp_reconciliations_delta_check" CHECK ("delta_snapshot" = "claimed_xp_snapshot" - "stored_xp_snapshot"),
  CONSTRAINT "gamification_xp_reconciliations_adjustment_check" CHECK ("adjustment_amount" = "delta_snapshot"),
  CONSTRAINT "gamification_xp_reconciliations_after_check" CHECK ("current_xp_after_snapshot" = "current_xp_before_snapshot" + "adjustment_amount")
);

CREATE UNIQUE INDEX "gamification_xp_reconciliations_id_workspace_key"
  ON "gamification_xp_reconciliations" ("id", "workspace_id");

CREATE UNIQUE INDEX "gamification_xp_reconciliations_idempotency_key"
  ON "gamification_xp_reconciliations" ("workspace_id", "membership_id", "idempotency_key");

CREATE INDEX "gamification_xp_reconciliations_member_created_idx"
  ON "gamification_xp_reconciliations" ("workspace_id", "membership_id", "created_at", "id");

CREATE INDEX "gamification_xp_reconciliations_actor_idx"
  ON "gamification_xp_reconciliations" ("actor_membership_id", "workspace_id");

ALTER TABLE "gamification_xp_reconciliations"
  ADD CONSTRAINT "gamification_xp_reconciliations_workspace_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_xp_reconciliations"
  ADD CONSTRAINT "gamification_xp_reconciliations_membership_fkey"
  FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_xp_reconciliations"
  ADD CONSTRAINT "gamification_xp_reconciliations_actor_fkey"
  FOREIGN KEY ("actor_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "gamification_xp_entries"
  ADD COLUMN "reconciliation_id" UUID;

CREATE INDEX "gamification_xp_entries_reconciliation_idx"
  ON "gamification_xp_entries" ("workspace_id", "reconciliation_id");

ALTER TABLE "gamification_xp_entries"
  ADD CONSTRAINT "gamification_xp_entries_reconciliation_fkey"
  FOREIGN KEY ("reconciliation_id", "workspace_id") REFERENCES "gamification_xp_reconciliations"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_gamification_xp_reconciliation_mutation()
RETURNS trigger AS $$
BEGIN
  IF OLD."status" IN ('APPLIED', 'NO_CHANGE') THEN
    RAISE EXCEPTION 'applied gamification_xp_reconciliations are immutable';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "gamification_xp_reconciliations_immutable"
BEFORE UPDATE OR DELETE ON "gamification_xp_reconciliations"
FOR EACH ROW EXECUTE FUNCTION prevent_gamification_xp_reconciliation_mutation();

INSERT INTO "permissions" ("key", "description")
VALUES
  ('gamification.xp_control.view', 'View Workspace XP Control Center analyzer'),
  ('gamification.xp_control.reconcile', 'Apply confirmed Workspace XP reconciliation corrections')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
CROSS JOIN "permissions"
WHERE "roles"."scope" = 'WORKSPACE'
  AND "roles"."key" IN ('OWNER', 'ADMIN', 'MANAGER')
  AND "permissions"."key" IN (
    'gamification.xp_control.view',
    'gamification.xp_control.reconcile'
  )
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
