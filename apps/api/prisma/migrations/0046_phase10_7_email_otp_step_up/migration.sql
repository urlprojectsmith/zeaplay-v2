CREATE TABLE "security_otp_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "refresh_token_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "target_membership_id" UUID NOT NULL,
    "purpose" "SecurityStepUpPurpose" NOT NULL,
    "economy" "GamificationAdminEconomy" NOT NULL,
    "otp_digest" TEXT NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_sent_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "invalidated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_otp_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "security_otp_challenges_attempt_count_check" CHECK ("attempt_count" >= 0),
    CONSTRAINT "security_otp_challenges_max_attempts_check" CHECK ("max_attempts" > 0 AND "max_attempts" <= 5)
);

CREATE INDEX "security_otp_challenges_user_session_context_idx" ON "security_otp_challenges"("user_id", "refresh_token_id", "purpose", "workspace_id", "target_membership_id", "economy");
CREATE INDEX "security_otp_challenges_workspace_target_context_idx" ON "security_otp_challenges"("workspace_id", "target_membership_id", "purpose", "economy");
CREATE INDEX "security_otp_challenges_expires_at_idx" ON "security_otp_challenges"("expires_at");
CREATE INDEX "security_otp_challenges_state_idx" ON "security_otp_challenges"("consumed_at", "invalidated_at", "expires_at");

ALTER TABLE "security_otp_challenges" ADD CONSTRAINT "security_otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_otp_challenges" ADD CONSTRAINT "security_otp_challenges_refresh_token_id_fkey" FOREIGN KEY ("refresh_token_id") REFERENCES "refresh_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_otp_challenges" ADD CONSTRAINT "security_otp_challenges_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "security_otp_challenges" ADD CONSTRAINT "security_otp_challenges_target_membership_id_workspace_id_fkey" FOREIGN KEY ("target_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
