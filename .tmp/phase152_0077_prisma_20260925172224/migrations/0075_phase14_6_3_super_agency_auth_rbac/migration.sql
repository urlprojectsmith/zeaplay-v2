-- Phase 14.6.3: Super Agency authentication/RBAC invitation foundation.
-- This migration intentionally does not auto-promote legacy Agency users into Super Agency memberships.

CREATE TYPE "SuperAgencyInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');

CREATE TABLE "super_agency_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "super_agency_id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "email_normalized" VARCHAR(320) NOT NULL,
  "role_id" UUID NOT NULL,
  "invited_by_membership_id" UUID NOT NULL,
  "accepted_by_user_id" UUID,
  "token_hash" VARCHAR(128) NOT NULL,
  "status" "SuperAgencyInvitationStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "super_agency_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "super_agency_invitations_token_hash_key"
  ON "super_agency_invitations"("token_hash");

CREATE UNIQUE INDEX "super_agency_invitations_pending_email_key"
  ON "super_agency_invitations"("super_agency_id", "email_normalized")
  WHERE "status" = 'PENDING';

CREATE INDEX "super_agency_invitations_super_agency_id_status_created_at_idx"
  ON "super_agency_invitations"("super_agency_id", "status", "created_at");

CREATE INDEX "super_agency_invitations_email_normalized_status_idx"
  ON "super_agency_invitations"("email_normalized", "status");

CREATE INDEX "super_agency_invitations_expires_at_idx"
  ON "super_agency_invitations"("expires_at");

ALTER TABLE "super_agency_invitations"
  ADD CONSTRAINT "super_agency_invitations_super_agency_id_fkey"
  FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "super_agency_invitations"
  ADD CONSTRAINT "super_agency_invitations_role_id_fkey"
  FOREIGN KEY ("role_id") REFERENCES "roles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "super_agency_invitations"
  ADD CONSTRAINT "super_agency_invitations_invited_by_membership_id_fkey"
  FOREIGN KEY ("invited_by_membership_id") REFERENCES "super_agency_memberships"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "super_agency_invitations"
  ADD CONSTRAINT "super_agency_invitations_accepted_by_user_id_fkey"
  FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
