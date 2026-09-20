CREATE TYPE "TicketSlaBusinessMode" AS ENUM ('ALWAYS', 'BUSINESS_HOURS');

CREATE TABLE "ticket_sla_policies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "description" VARCHAR(500),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "timezone" VARCHAR(80) NOT NULL,
  "business_mode" "TicketSlaBusinessMode" NOT NULL DEFAULT 'BUSINESS_HOURS',
  "business_hours" JSONB NOT NULL,
  "holiday_dates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_sla_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_sla_policies_name_nonblank_check" CHECK (length(btrim("name")) > 0)
);

CREATE TABLE "ticket_sla_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "priority" "TaskPriority" NOT NULL,
  "first_response_minutes" INTEGER NOT NULL,
  "resolution_minutes" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_sla_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_sla_rules_first_response_positive_check" CHECK ("first_response_minutes" BETWEEN 1 AND 525600),
  CONSTRAINT "ticket_sla_rules_resolution_positive_check" CHECK ("resolution_minutes" BETWEEN 1 AND 525600)
);

CREATE TABLE "ticket_sla_pause_statuses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "policy_id" UUID NOT NULL,
  "status_definition_id" UUID NOT NULL,
  "pause_first_response" BOOLEAN NOT NULL DEFAULT false,
  "pause_resolution" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_sla_pause_statuses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_sla_pause_statuses_any_metric_check" CHECK ("pause_first_response" OR "pause_resolution")
);

CREATE TABLE "ticket_sla_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "ticket_id" UUID NOT NULL,
  "source_policy_id" UUID,
  "policy_snapshot" JSONB NOT NULL,
  "priority_snapshot" "TaskPriority" NOT NULL,
  "first_response_target_minutes" INTEGER NOT NULL,
  "first_response_remaining_minutes" INTEGER NOT NULL,
  "first_response_run_started_at" TIMESTAMPTZ(6),
  "first_response_due_at" TIMESTAMPTZ(6),
  "first_response_paused_at" TIMESTAMPTZ(6),
  "first_response_completed_at" TIMESTAMPTZ(6),
  "first_response_breached_at" TIMESTAMPTZ(6),
  "first_response_not_applicable_at" TIMESTAMPTZ(6),
  "resolution_target_minutes" INTEGER NOT NULL,
  "resolution_remaining_minutes" INTEGER NOT NULL,
  "resolution_run_started_at" TIMESTAMPTZ(6),
  "resolution_due_at" TIMESTAMPTZ(6),
  "resolution_paused_at" TIMESTAMPTZ(6),
  "resolution_completed_at" TIMESTAMPTZ(6),
  "resolution_breached_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_sla_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ticket_sla_states_first_response_target_positive_check" CHECK ("first_response_target_minutes" BETWEEN 1 AND 525600),
  CONSTRAINT "ticket_sla_states_resolution_target_positive_check" CHECK ("resolution_target_minutes" BETWEEN 1 AND 525600),
  CONSTRAINT "ticket_sla_states_first_response_remaining_nonnegative_check" CHECK ("first_response_remaining_minutes" BETWEEN 0 AND 525600),
  CONSTRAINT "ticket_sla_states_resolution_remaining_nonnegative_check" CHECK ("resolution_remaining_minutes" BETWEEN 0 AND 525600)
);

CREATE UNIQUE INDEX "ticket_sla_policies_id_workspace_id_key"
  ON "ticket_sla_policies"("id", "workspace_id");

CREATE INDEX "ticket_sla_policies_workspace_id_is_active_is_default_idx"
  ON "ticket_sla_policies"("workspace_id", "is_active", "is_default");

CREATE UNIQUE INDEX "ticket_sla_policies_one_default_active_idx"
  ON "ticket_sla_policies"("workspace_id")
  WHERE "is_active" = true AND "is_default" = true;

CREATE UNIQUE INDEX "ticket_sla_rules_policy_id_priority_key"
  ON "ticket_sla_rules"("policy_id", "priority");

CREATE INDEX "ticket_sla_rules_workspace_id_policy_id_idx"
  ON "ticket_sla_rules"("workspace_id", "policy_id");

CREATE UNIQUE INDEX "ticket_sla_pause_statuses_policy_id_status_definition_id_key"
  ON "ticket_sla_pause_statuses"("policy_id", "status_definition_id");

CREATE INDEX "ticket_sla_pause_statuses_workspace_id_status_definition_id_idx"
  ON "ticket_sla_pause_statuses"("workspace_id", "status_definition_id");

CREATE UNIQUE INDEX "ticket_sla_states_ticket_id_key"
  ON "ticket_sla_states"("ticket_id");

CREATE UNIQUE INDEX "ticket_sla_states_ticket_id_workspace_id_key"
  ON "ticket_sla_states"("ticket_id", "workspace_id");

CREATE UNIQUE INDEX "ticket_sla_states_id_workspace_id_key"
  ON "ticket_sla_states"("id", "workspace_id");

CREATE INDEX "ticket_sla_states_workspace_id_first_response_due_at_idx"
  ON "ticket_sla_states"("workspace_id", "first_response_due_at");

CREATE INDEX "ticket_sla_states_workspace_id_resolution_due_at_idx"
  ON "ticket_sla_states"("workspace_id", "resolution_due_at");

CREATE INDEX "ticket_sla_states_workspace_id_source_policy_id_idx"
  ON "ticket_sla_states"("workspace_id", "source_policy_id");

ALTER TABLE "ticket_sla_policies"
  ADD CONSTRAINT "ticket_sla_policies_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_sla_rules"
  ADD CONSTRAINT "ticket_sla_rules_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_sla_rules"
  ADD CONSTRAINT "ticket_sla_rules_policy_id_workspace_id_fkey"
  FOREIGN KEY ("policy_id", "workspace_id") REFERENCES "ticket_sla_policies"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_sla_pause_statuses"
  ADD CONSTRAINT "ticket_sla_pause_statuses_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_sla_pause_statuses"
  ADD CONSTRAINT "ticket_sla_pause_statuses_policy_id_workspace_id_fkey"
  FOREIGN KEY ("policy_id", "workspace_id") REFERENCES "ticket_sla_policies"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_sla_pause_statuses"
  ADD CONSTRAINT "ticket_sla_pause_statuses_status_definition_id_workspace_id_fkey"
  FOREIGN KEY ("status_definition_id", "workspace_id") REFERENCES "status_definitions"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_sla_states"
  ADD CONSTRAINT "ticket_sla_states_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_sla_states"
  ADD CONSTRAINT "ticket_sla_states_ticket_id_workspace_id_fkey"
  FOREIGN KEY ("ticket_id", "workspace_id") REFERENCES "tickets"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ticket_sla_states"
  ADD CONSTRAINT "ticket_sla_states_source_policy_id_workspace_id_fkey"
  FOREIGN KEY ("source_policy_id", "workspace_id") REFERENCES "ticket_sla_policies"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "permissions" ("key", "description")
VALUES
  ('tickets.sla.view', 'tickets.sla.view permission'),
  ('tickets.sla.manage', 'tickets.sla.manage permission')
ON CONFLICT ("key") DO NOTHING;

WITH ticket_sla_permissions AS (
  SELECT "id", "key"
  FROM "permissions"
  WHERE "key" IN ('tickets.sla.view', 'tickets.sla.manage')
),
system_role_permission_keys AS (
  SELECT *
  FROM (
    VALUES
      ('OWNER', 'tickets.sla.view'),
      ('OWNER', 'tickets.sla.manage'),
      ('ADMIN', 'tickets.sla.view'),
      ('ADMIN', 'tickets.sla.manage'),
      ('MANAGER', 'tickets.sla.view')
  ) AS grants("role_key", "permission_key")
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles."id", ticket_sla_permissions."id"
FROM "roles"
JOIN system_role_permission_keys ON system_role_permission_keys."role_key" = roles."key"
JOIN ticket_sla_permissions ON ticket_sla_permissions."key" = system_role_permission_keys."permission_key"
WHERE roles."scope" = 'WORKSPACE'::"RoleScope"
  AND roles."is_system" = true
  AND roles."workspace_id" IS NULL
ON CONFLICT ("role_id", "permission_id") DO NOTHING;
