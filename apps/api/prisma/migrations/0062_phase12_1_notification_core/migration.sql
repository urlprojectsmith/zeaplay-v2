-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('TASK', 'PROJECT', 'TICKET', 'AUTOMATION', 'GAMIFICATION', 'SYSTEM', 'CALENDAR');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('TASK_ASSIGNED', 'TASK_STATUS_CHANGED', 'TASK_DUE_SOON', 'TASK_OVERDUE', 'PROJECT_ASSIGNED', 'PROJECT_STATUS_CHANGED', 'PROJECT_DUE_SOON', 'TICKET_ASSIGNED', 'TICKET_STATUS_CHANGED', 'TICKET_RESOLVED', 'TICKET_SLA_WARNING', 'AUTOMATION_EXECUTION_FAILED', 'AUTOMATION_DEAD_LETTERED', 'GAMIFICATION_ACHIEVEMENT_EARNED', 'GAMIFICATION_BADGE_EARNED', 'GAMIFICATION_REWARD_REDEEMED', 'SYSTEM_ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('NORMAL', 'IMPORTANT', 'URGENT');

-- CreateEnum
CREATE TYPE "NotificationEntityType" AS ENUM ('TASK', 'PROJECT', 'TICKET', 'AUTOMATION_EXECUTION', 'ACHIEVEMENT', 'REWARD', 'CALENDAR_EVENT');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "recipient_membership_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "message" VARCHAR(600) NOT NULL,
    "entity_type" "NotificationEntityType",
    "entity_id" UUID,
    "actor_membership_id" UUID,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "read_at" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "dedupe_key" VARCHAR(180),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT false,
    "push_enabled" BOOLEAN NOT NULL DEFAULT false,
    "muted_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_id_workspace_id_key" ON "notifications"("id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_workspace_recipient_dedupe_key" ON "notifications"("workspace_id", "recipient_membership_id", "dedupe_key") WHERE "dedupe_key" IS NOT NULL;

-- CreateIndex
CREATE INDEX "notifications_workspace_recipient_created_idx" ON "notifications"("workspace_id", "recipient_membership_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_workspace_recipient_read_created_idx" ON "notifications"("workspace_id", "recipient_membership_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_workspace_recipient_category_created_idx" ON "notifications"("workspace_id", "recipient_membership_id", "category", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_membership_id_category_key" ON "notification_preferences"("membership_id", "category");

-- CreateIndex
CREATE INDEX "notification_preferences_workspace_membership_idx" ON "notification_preferences"("workspace_id", "membership_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_id_workspace_id_fkey" FOREIGN KEY ("recipient_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_membership_id_workspace_id_fkey" FOREIGN KEY ("actor_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_membership_id_workspace_id_fkey" FOREIGN KEY ("membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE RESTRICT ON UPDATE CASCADE;
