CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

CREATE TYPE "ApiIdempotencyStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "api_keys" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "description" VARCHAR(500),
  "public_identifier" VARCHAR(32) NOT NULL,
  "prefix" VARCHAR(48) NOT NULL,
  "secret_hash" VARCHAR(128) NOT NULL,
  "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  "scopes" TEXT[] NOT NULL,
  "created_by_membership_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(6),
  "last_used_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "api_idempotency_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "api_key_id" UUID NOT NULL,
  "idempotency_key_hash" VARCHAR(128) NOT NULL,
  "method" VARCHAR(12) NOT NULL,
  "route_key" VARCHAR(120) NOT NULL,
  "request_fingerprint" VARCHAR(128) NOT NULL,
  "response_resource_id" UUID,
  "response_body" JSONB,
  "status" "ApiIdempotencyStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "api_idempotency_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "api_keys_public_identifier_key" ON "api_keys"("public_identifier");
CREATE INDEX "api_keys_workspace_id_status_idx" ON "api_keys"("workspace_id", "status");
CREATE INDEX "api_keys_workspace_id_created_at_idx" ON "api_keys"("workspace_id", "created_at");
CREATE UNIQUE INDEX "api_idempotency_records_workspace_id_api_key_id_idempotency_key_hash_method_route_key_key" ON "api_idempotency_records"("workspace_id", "api_key_id", "idempotency_key_hash", "method", "route_key");
CREATE INDEX "api_idempotency_records_expires_at_idx" ON "api_idempotency_records"("expires_at");

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "api_keys"
  ADD CONSTRAINT "api_keys_created_by_membership_id_fkey"
  FOREIGN KEY ("created_by_membership_id") REFERENCES "workspace_memberships"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "api_idempotency_records"
  ADD CONSTRAINT "api_idempotency_records_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "api_idempotency_records"
  ADD CONSTRAINT "api_idempotency_records_api_key_id_fkey"
  FOREIGN KEY ("api_key_id") REFERENCES "api_keys"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
