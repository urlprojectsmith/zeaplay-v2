import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..', '..', '..');
const schema = readFileSync(join(root, 'prisma', 'schema.prisma'), 'utf8');
const migration = readFileSync(
  join(root, 'prisma', 'migrations', '0076_phase15_1_billing_foundation', 'migration.sql'),
  'utf8',
);
const hardeningMigration = readFileSync(
  join(
    root,
    'prisma',
    'migrations',
    '0077_phase15_1_billing_foundation_hardening',
    'migration.sql',
  ),
  'utf8',
);
const stripeLifecycleMigration = readFileSync(
  join(
    root,
    'prisma',
    'migrations',
    '0078_phase15_2_stripe_subscription_lifecycle',
    'migration.sql',
  ),
  'utf8',
);
const invoiceProjectionMigration = readFileSync(
  join(root, 'prisma', 'migrations', '0080_phase15_4_invoice_projection', 'migration.sql'),
  'utf8',
);
const permissions = readFileSync(
  join(root, 'src', 'common', 'authorization', 'permissions.ts'),
  'utf8',
);
const seed = readFileSync(join(root, 'prisma', 'seed.ts'), 'utf8');
const superAgencyService = readFileSync(
  join(root, 'src', 'modules', 'super-agencies', 'super-agencies.service.ts'),
  'utf8',
);
const operationalSourceFiles = [
  'src/modules/tasks/tasks.service.ts',
  'src/modules/projects/projects.service.ts',
  'src/modules/tickets/tickets.service.ts',
  'src/modules/automation/automation.service.ts',
  'src/modules/assets/assets.service.ts',
  'src/modules/public-api/api-keys.service.ts',
  'src/modules/public-api/public-projects.controller.ts',
  'src/modules/public-api/public-tasks.controller.ts',
  'src/modules/public-api/public-tickets.controller.ts',
  'src/modules/webhooks/webhooks.service.ts',
  'src/modules/inbound-webhooks/inbound-webhooks.service.ts',
  'src/modules/integrations/integrations.service.ts',
  'src/modules/gamification/gamification.service.ts',
].map((relativePath) => [relativePath, readFileSync(join(root, relativePath), 'utf8')] as const);

describe('Phase 15.2 billing schema and permission boundaries', () => {
  it('models only Super Agency as the ZeaPlay master subscription owner', () => {
    expect(schema).toContain('model SuperAgencySubscription');
    expect(schema).toContain('superAgencyId  String');
    expect(schema).not.toContain('model AgencySubscription');
    expect(schema).not.toContain('model WorkspaceSubscription');
    expect(schema).not.toContain('model OrganizationSubscription');
    expect(schema).toContain('model SuperAgencyBillingAccount');
    expect(schema).not.toMatch(/model AgencyBillingAccount|model WorkspaceBillingAccount/i);
  });

  it('keeps plans platform-owned and versions immutable by relation', () => {
    expect(schema).toContain('model MasterPlan');
    expect(schema).toContain('enum MasterPlanType');
    expect(schema).toContain('PRIVATE');
    expect(schema).toContain('ENTERPRISE');
    expect(schema).toContain('INTERNAL');
    expect(schema).toContain('FREE');
    expect(schema).toContain('DEMO');
    expect(schema).toContain('QA');
    expect(schema).toContain('model MasterPlanVersion');
    expect(schema).toContain('model PlanEntitlement');
    expect(schema).toContain('@@unique([masterPlanId, versionNumber])');
    expect(schema).toMatch(/planVersionId\s+String/);
    expect(migration).toContain('master_plan_versions_one_draft_per_plan_key');
    expect(hardeningMigration).toContain('CREATE TYPE "MasterPlanType"');
    expect(migration).toContain('super_agency_subscriptions_one_current_per_super_agency_key');
  });

  it('uses typed entitlements and explicit unlimited semantics without magic negative limits', () => {
    expect(schema).toContain('enum PlanEntitlementValueType');
    expect(schema).toContain('UNLIMITED');
    expect(schema).toMatch(/numericValue\s+BigInt\?/);
    expect(migration).toContain('"numeric_value" >= 0');
    expect(migration).not.toContain('-1');
  });

  it('keeps billing status separate from tenant operational status', () => {
    expect(schema).toContain('enum SuperAgencyStatus');
    expect(schema).toContain('enum SuperAgencySubscriptionStatus');
    expect(schema).toContain('GRACE_PERIOD');
    expect(schema).toContain('RESTRICTED');
    expect(schema).toMatch(/status\s+SuperAgencySubscriptionStatus/);
  });

  it('adds immutable Billing History separately from security AuditLog', () => {
    expect(schema).toContain('model BillingHistory');
    expect(schema).toContain('enum BillingHistoryEventType');
    expect(schema).toContain('PLAN_ASSIGNED');
    expect(schema).toContain('TRIAL_STARTED');
    expect(schema).toContain('SUBSCRIPTION_ACTIVATED');
    expect(schema).toContain('PAYMENT_FAILED');
    expect(schema).not.toContain('INVOICE_PAID');
    expect(hardeningMigration).toContain('CREATE TABLE "billing_history"');
  });

  it('adds Stripe price, customer, checkout, and event idempotency tables without Agency or Workspace billing owners', () => {
    expect(schema).toContain('model BillingPrice');
    expect(schema).toContain('model BillingCheckoutAttempt');
    expect(schema).toContain('model StripeBillingEvent');
    expect(schema).toMatch(/stripeCustomerId\s+String\?/);
    expect(schema).toContain('stripeEventId');
    expect(stripeLifecycleMigration).toContain('CREATE TABLE "billing_prices"');
    expect(stripeLifecycleMigration).toContain('CREATE TABLE "super_agency_billing_accounts"');
    expect(stripeLifecycleMigration).toContain('CREATE TABLE "billing_checkout_attempts"');
    expect(stripeLifecycleMigration).toContain('CREATE TABLE "stripe_billing_events"');
  });

  it('adds a minimal Super Agency-owned invoice projection without card or raw Stripe payload storage', () => {
    expect(schema).toContain('model BillingInvoice');
    expect(schema).toMatch(/superAgencyId\s+String/);
    expect(schema).toMatch(/providerInvoiceId\s+String/);
    expect(schema).toMatch(/amountDueMinor\s+BigInt/);
    expect(schema).toMatch(/hostedInvoiceUrl\s+String\?/);
    expect(schema).toMatch(/invoicePdfUrl\s+String\?/);
    expect(schema).toContain('@@unique([provider, providerInvoiceId])');
    expect(invoiceProjectionMigration).toContain('CREATE TABLE "billing_invoices"');
    expect(invoiceProjectionMigration).toContain('"super_agency_id" UUID NOT NULL');
    expect(invoiceProjectionMigration).toContain('"amount_due_minor" BIGINT NOT NULL DEFAULT 0');
    expect(invoiceProjectionMigration).not.toMatch(/payment_method|raw|json|card_number|cvv|cvc/i);
    expect(schema).not.toMatch(
      /model AgencyInvoice|model WorkspaceInvoice|model OrganizationInvoice/i,
    );
  });

  it('keeps plan management Platform-only while allowing Super Agency subscription view roles', () => {
    expect(permissions).toContain("billingPlanManage: 'billing.plan.manage'");
    expect(permissions).toContain("billingSubscriptionView: 'billing.subscription.view'");
    expect(seed).toContain("'billing.plan.manage'");
    expect(seed).toContain("'billing.subscription.view'");
    expect(seed).toContain("'billing.checkout.create'");
    expect(seed).toContain("'billing.portal.create'");
    expect(seed).toContain("'billing.invoice.view'");
    expect(seed).toContain("'billing.payment_method.view'");
    expect(seed).toContain("'billing.history.view'");
    expect(seed).toContain("'billing.price.manage'");
    expect(seed).toContain("'billing.trial.manage'");
    expect(permissions).toContain('PLATFORM_ONLY_PERMISSION_KEYS');
    expect(permissions).toContain('PermissionKeys.billingPlanManage');
    expect(permissions).toContain('PermissionKeys.billingPriceManage');
    expect(permissions).toContain('PermissionKeys.billingTrialManage');
    expect(permissions).toContain('PermissionKeys.billingSupportView');
    expect(superAgencyService).toContain('PLATFORM_ONLY_PERMISSION_KEYS');
  });

  it('does not introduce Phase 15.3 resource or plan-limit enforcement into operational modules', () => {
    for (const [relativePath, source] of operationalSourceFiles) {
      const leakedCommercialBilling = source.match(
        /BillingService|MasterPlan|PlanEntitlement|billing\.plan|BillingPrice|amountMinor|externalPriceId/i,
      );
      if (leakedCommercialBilling) {
        throw new Error(
          `${relativePath} contains Phase 15.3-style plan/resource enforcement marker ${leakedCommercialBilling[0]}`,
        );
      }
    }
  });

  it('keeps Stripe SDK usage centralized and avoids custom card-data scope', () => {
    const combinedBillingSource = [
      schema,
      migration,
      hardeningMigration,
      stripeLifecycleMigration,
      readFileSync(join(root, 'src', 'modules', 'billing', 'billing.service.ts'), 'utf8'),
      readFileSync(join(root, 'src', 'modules', 'billing', 'billing.controller.ts'), 'utf8'),
      readFileSync(join(root, 'src', 'modules', 'billing', 'billing.stripe-gateway.ts'), 'utf8'),
    ].join('\n');

    expect(
      readFileSync(join(root, 'src', 'modules', 'billing', 'billing.service.ts'), 'utf8'),
    ).not.toMatch(/from ['"]stripe['"]|new Stripe/);
    expect(combinedBillingSource).not.toMatch(
      /PaymentIntent|SetupIntent|cardNumber|cvv|rawCard|automatic_tax/i,
    );
  });
});
