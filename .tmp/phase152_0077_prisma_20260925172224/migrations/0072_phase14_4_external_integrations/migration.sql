CREATE TYPE "IntegrationProvider" AS ENUM ('GOHIGHLEVEL', 'SLACK', 'WEBEX', 'GENERIC_REST');

CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'REAUTH_REQUIRED', 'ERROR', 'DISABLED');

CREATE TYPE "IntegrationAuthType" AS ENUM ('OAUTH', 'BEARER_TOKEN', 'API_KEY', 'BASIC_AUTH');

CREATE TYPE "IntegrationActionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS');

CREATE TABLE "integration_connections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "status" "IntegrationStatus" NOT NULL DEFAULT 'CONNECTED',
  "auth_type" "IntegrationAuthType" NOT NULL,
  "provider_account_id" VARCHAR(255),
  "provider_account_label" VARCHAR(255),
  "encrypted_credentials" TEXT,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "configuration_json" JSONB NOT NULL DEFAULT '{}',
  "connected_by_membership_id" UUID NOT NULL,
  "last_validated_at" TIMESTAMPTZ(6),
  "last_success_at" TIMESTAMPTZ(6),
  "last_failure_at" TIMESTAMPTZ(6),
  "safe_error_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "revoked_at" TIMESTAMPTZ(6),

  CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_oauth_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "actor_membership_id" UUID NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "state_hash" VARCHAR(128) NOT NULL,
  "redirect_path" VARCHAR(512),
  "encrypted_pkce_verifier" TEXT,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "consumed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integration_oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_action_executions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "provider" "IntegrationProvider" NOT NULL,
  "capability" VARCHAR(120) NOT NULL,
  "status" "IntegrationActionStatus" NOT NULL DEFAULT 'PENDING',
  "actor_membership_id" UUID,
  "request_summary_json" JSONB NOT NULL,
  "response_summary_json" JSONB,
  "safe_error_code" VARCHAR(120),
  "duration_ms" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),

  CONSTRAINT "integration_action_executions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_action_idempotency_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "connection_id" UUID NOT NULL,
  "capability" VARCHAR(120) NOT NULL,
  "idempotency_key_hash" VARCHAR(64) NOT NULL,
  "request_fingerprint" VARCHAR(64) NOT NULL,
  "status" "IntegrationActionStatus" NOT NULL DEFAULT 'PENDING',
  "execution_id" UUID,
  "response_body" JSONB,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "integration_action_idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_connections_id_workspace_id_key" ON "integration_connections"("id", "workspace_id");
CREATE INDEX "integration_connections_workspace_id_provider_idx" ON "integration_connections"("workspace_id", "provider");
CREATE INDEX "integration_connections_workspace_id_status_idx" ON "integration_connections"("workspace_id", "status");
CREATE INDEX "integration_connections_workspace_id_created_at_idx" ON "integration_connections"("workspace_id", "created_at");

CREATE UNIQUE INDEX "integration_oauth_states_state_hash_key" ON "integration_oauth_states"("state_hash");
CREATE INDEX "integration_oauth_states_expires_at_idx" ON "integration_oauth_states"("expires_at");
CREATE INDEX "integration_oauth_states_workspace_id_provider_expires_at_idx" ON "integration_oauth_states"("workspace_id", "provider", "expires_at");

CREATE INDEX "integration_action_executions_workspace_id_created_at_idx" ON "integration_action_executions"("workspace_id", "created_at");
CREATE INDEX "integration_action_executions_connection_id_created_at_idx" ON "integration_action_executions"("connection_id", "created_at");
CREATE INDEX "integration_action_executions_status_created_at_idx" ON "integration_action_executions"("status", "created_at");

CREATE UNIQUE INDEX "integration_action_idempotency_records_connection_id_capability_idempotency_key_hash_key" ON "integration_action_idempotency_records"("connection_id", "capability", "idempotency_key_hash");
CREATE INDEX "integration_action_idempotency_records_workspace_id_expires_at_idx" ON "integration_action_idempotency_records"("workspace_id", "expires_at");
CREATE INDEX "integration_action_idempotency_records_expires_at_idx" ON "integration_action_idempotency_records"("expires_at");

ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_connected_by_membership_id_workspace_id_fkey" FOREIGN KEY ("connected_by_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_actor_membership_id_workspace_id_fkey" FOREIGN KEY ("actor_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_action_executions" ADD CONSTRAINT "integration_action_executions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_action_executions" ADD CONSTRAINT "integration_action_executions_connection_id_workspace_id_fkey" FOREIGN KEY ("connection_id", "workspace_id") REFERENCES "integration_connections"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_action_executions" ADD CONSTRAINT "integration_action_executions_actor_membership_id_workspace_id_fkey" FOREIGN KEY ("actor_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_action_idempotency_records" ADD CONSTRAINT "integration_action_idempotency_records_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_action_idempotency_records" ADD CONSTRAINT "integration_action_idempotency_records_connection_id_workspace_id_fkey" FOREIGN KEY ("connection_id", "workspace_id") REFERENCES "integration_connections"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
