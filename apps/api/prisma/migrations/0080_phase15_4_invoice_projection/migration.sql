-- Phase 15.4: minimal provider invoice projection for Super Agency billing UI.
-- Stripe remains the invoice source of truth; this table is a bounded read model.

CREATE TABLE "billing_invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "super_agency_id" UUID NOT NULL,
  "provider" "BillingProvider" NOT NULL DEFAULT 'STRIPE',
  "provider_invoice_id" VARCHAR(120) NOT NULL,
  "provider_subscription_id" VARCHAR(120),
  "invoice_number" VARCHAR(120),
  "currency" VARCHAR(3) NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "amount_due_minor" BIGINT NOT NULL DEFAULT 0,
  "amount_paid_minor" BIGINT NOT NULL DEFAULT 0,
  "amount_remaining_minor" BIGINT NOT NULL DEFAULT 0,
  "provider_created_at" TIMESTAMPTZ(6) NOT NULL,
  "due_at" TIMESTAMPTZ(6),
  "period_start" TIMESTAMPTZ(6),
  "period_end" TIMESTAMPTZ(6),
  "finalized_at" TIMESTAMPTZ(6),
  "paid_at" TIMESTAMPTZ(6),
  "voided_at" TIMESTAMPTZ(6),
  "hosted_invoice_url" VARCHAR(2048),
  "invoice_pdf_url" VARCHAR(2048),
  "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_invoices_super_agency_id_fkey"
    FOREIGN KEY ("super_agency_id") REFERENCES "super_agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_invoices_amount_due_minor_nonnegative_check" CHECK ("amount_due_minor" >= 0),
  CONSTRAINT "billing_invoices_amount_paid_minor_nonnegative_check" CHECK ("amount_paid_minor" >= 0),
  CONSTRAINT "billing_invoices_amount_remaining_minor_nonnegative_check" CHECK ("amount_remaining_minor" >= 0)
);

CREATE UNIQUE INDEX "billing_invoices_provider_provider_invoice_id_key"
  ON "billing_invoices"("provider", "provider_invoice_id");
CREATE INDEX "billing_invoices_super_agency_id_provider_created_at_idx"
  ON "billing_invoices"("super_agency_id", "provider_created_at");
CREATE INDEX "billing_invoices_super_agency_id_status_idx"
  ON "billing_invoices"("super_agency_id", "status");
CREATE INDEX "billing_invoices_provider_invoice_id_idx"
  ON "billing_invoices"("provider_invoice_id");
CREATE INDEX "billing_invoices_provider_subscription_id_idx"
  ON "billing_invoices"("provider_subscription_id");
