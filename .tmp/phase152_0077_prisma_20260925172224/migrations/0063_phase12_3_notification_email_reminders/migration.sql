CREATE TYPE "NotificationEmailDeliveryStatus" AS ENUM (
  'PENDING',
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'AMBIGUOUS',
  'SKIPPED'
);

CREATE TYPE "NotificationReminderStatus" AS ENUM (
  'PENDING',
  'FIRED',
  'CANCELLED',
  'SKIPPED'
);

CREATE TYPE "NotificationReminderType" AS ENUM (
  'TASK_DUE_SOON',
  'TASK_OVERDUE',
  'PROJECT_DUE_SOON',
  'TICKET_SLA_WARNING'
);

CREATE TABLE "notification_email_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "recipient_membership_id" UUID NOT NULL,
  "category" "NotificationCategory" NOT NULL,
  "type" "NotificationType" NOT NULL,
  "template_key" VARCHAR(80) NOT NULL,
  "template_data" JSONB,
  "entity_type" "NotificationEntityType",
  "entity_id" UUID,
  "status" "NotificationEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 3,
  "idempotency_key" VARCHAR(180) NOT NULL,
  "provider" VARCHAR(40),
  "provider_message_id" VARCHAR(160),
  "scheduled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "queued_at" TIMESTAMPTZ(6),
  "sent_at" TIMESTAMPTZ(6),
  "failure_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "notification_email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_reminders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "recipient_membership_id" UUID NOT NULL,
  "reminder_type" "NotificationReminderType" NOT NULL,
  "category" "NotificationCategory" NOT NULL,
  "type" "NotificationType" NOT NULL,
  "entity_type" "NotificationEntityType" NOT NULL,
  "entity_id" UUID NOT NULL,
  "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
  "status" "NotificationReminderStatus" NOT NULL DEFAULT 'PENDING',
  "dedupe_key" VARCHAR(180) NOT NULL,
  "fired_at" TIMESTAMPTZ(6),
  "skipped_at" TIMESTAMPTZ(6),
  "cancelled_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "notification_reminders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_email_delivery_dedupe_uq"
  ON "notification_email_deliveries"("workspace_id", "recipient_membership_id", "idempotency_key");
CREATE INDEX "notification_email_delivery_dispatch_idx"
  ON "notification_email_deliveries"("status", "scheduled_at", "id");
CREATE INDEX "notification_email_delivery_recipient_idx"
  ON "notification_email_deliveries"("workspace_id", "recipient_membership_id", "status", "created_at");

CREATE UNIQUE INDEX "notification_reminder_dedupe_uq"
  ON "notification_reminders"("workspace_id", "recipient_membership_id", "dedupe_key");
CREATE INDEX "notification_reminder_due_idx"
  ON "notification_reminders"("status", "scheduled_for", "id");
CREATE INDEX "notification_reminder_entity_idx"
  ON "notification_reminders"("workspace_id", "entity_type", "entity_id", "status");
CREATE INDEX "notification_reminder_recipient_idx"
  ON "notification_reminders"("workspace_id", "recipient_membership_id", "status", "scheduled_for");

ALTER TABLE "notification_email_deliveries"
  ADD CONSTRAINT "notification_email_deliveries_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_email_deliveries"
  ADD CONSTRAINT "notification_email_deliveries_recipient_membership_id_workspace_id_fkey"
  FOREIGN KEY ("recipient_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notification_reminders"
  ADD CONSTRAINT "notification_reminders_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notification_reminders"
  ADD CONSTRAINT "notification_reminders_recipient_membership_id_workspace_id_fkey"
  FOREIGN KEY ("recipient_membership_id", "workspace_id") REFERENCES "workspace_memberships"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
