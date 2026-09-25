import Stripe from 'stripe';
import { StripeBillingGateway } from './billing.stripe-gateway';

jest.mock('stripe', () => jest.fn());

const stripeClient = {
  customers: { create: jest.fn(), retrieve: jest.fn() },
  products: { create: jest.fn() },
  prices: { create: jest.fn() },
  checkout: { sessions: { create: jest.fn() } },
  billingPortal: { sessions: { create: jest.fn() } },
  subscriptions: { retrieve: jest.fn(), update: jest.fn(), cancel: jest.fn() },
  subscriptionSchedules: { create: jest.fn(), update: jest.fn() },
  invoices: { retrieve: jest.fn(), list: jest.fn() },
  paymentMethods: { retrieve: jest.fn() },
  webhooks: { constructEvent: jest.fn() },
};

describe('StripeBillingGateway', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    (Stripe as unknown as jest.Mock).mockImplementation(() => stripeClient);
    process.env = { ...originalEnv, ...env(), STRIPE_ENABLED: 'true' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates hosted Checkout sessions in subscription mode with server-owned price and return URLs', async () => {
    stripeClient.checkout.sessions.create.mockResolvedValue({ id: 'cs_123' });
    const gateway = new StripeBillingGateway();

    await gateway.createCheckoutSession({
      customerId: 'cus_123',
      priceId: 'price_123',
      successUrl: 'https://app.test/success',
      cancelUrl: 'https://app.test/cancel',
      clientReferenceId: 'attempt-1',
      metadata: { superAgencyId: 'super-agency-1' },
      idempotencyKey: 'checkout-key',
    });

    expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        customer: 'cus_123',
        line_items: [{ price: 'price_123', quantity: 1 }],
        success_url: 'https://app.test/success',
        cancel_url: 'https://app.test/cancel',
        client_reference_id: 'attempt-1',
      }),
      { idempotencyKey: 'checkout-key' },
    );
  });

  it('uses the configured Customer Portal configuration and disables client-controlled returns', async () => {
    stripeClient.billingPortal.sessions.create.mockResolvedValue({ id: 'bps_123' });
    const gateway = new StripeBillingGateway();

    await gateway.createPortalSession({
      customerId: 'cus_123',
      returnUrl: 'https://app.test/billing',
      idempotencyKey: 'portal-key',
    });

    expect(stripeClient.billingPortal.sessions.create).toHaveBeenCalledWith(
      {
        customer: 'cus_123',
        configuration: 'bpc_test_123',
        return_url: 'https://app.test/billing',
      },
      { idempotencyKey: 'portal-key' },
    );
  });

  it('requests immediate upgrade with proration and pending payment safety', async () => {
    stripeClient.subscriptions.update.mockResolvedValue({ id: 'sub_123' });
    const gateway = new StripeBillingGateway();

    await gateway.updateSubscriptionForUpgrade({
      subscriptionId: 'sub_123',
      subscriptionItemId: 'si_123',
      priceId: 'price_upgrade',
      idempotencyKey: 'upgrade-key',
    });

    expect(stripeClient.subscriptions.update).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({
        items: [{ id: 'si_123', price: 'price_upgrade' }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
      }),
      { idempotencyKey: 'upgrade-key' },
    );
  });

  it('schedules downgrades with current and future phases at the period boundary', async () => {
    stripeClient.subscriptionSchedules.create.mockResolvedValue({ id: 'sub_sched_123' });
    stripeClient.subscriptionSchedules.update.mockResolvedValue({ id: 'sub_sched_123' });
    const gateway = new StripeBillingGateway();

    await gateway.schedulePriceChange({
      subscriptionId: 'sub_123',
      currentPriceId: 'price_current',
      priceId: 'price_downgrade',
      currentPeriodStart: new Date('2026-09-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z'),
      idempotencyKey: 'schedule-key',
    });

    expect(stripeClient.subscriptionSchedules.create).toHaveBeenCalledWith(
      { from_subscription: 'sub_123' },
      { idempotencyKey: 'schedule-key:create' },
    );
    expect(stripeClient.subscriptionSchedules.update).toHaveBeenCalledWith(
      'sub_sched_123',
      {
        phases: [
          {
            start_date: 1788220800,
            end_date: 1790812800,
            items: [{ price: 'price_current', quantity: 1 }],
          },
          {
            start_date: 1790812800,
            items: [{ price: 'price_downgrade', quantity: 1 }],
          },
        ],
      },
      { idempotencyKey: 'schedule-key:update' },
    );
  });

  it('retrieves invoices without exposing raw provider payloads outside the gateway', async () => {
    stripeClient.invoices.retrieve.mockResolvedValue({ id: 'in_123' });
    stripeClient.invoices.list.mockResolvedValue({ data: [{ id: 'in_123' }] });
    const gateway = new StripeBillingGateway();

    await expect(gateway.retrieveInvoice('in_123')).resolves.toMatchObject({ id: 'in_123' });
    await expect(gateway.listInvoices({ customerId: 'cus_123', limit: 25 })).resolves.toMatchObject(
      { data: [{ id: 'in_123' }] },
    );
    expect(stripeClient.invoices.retrieve).toHaveBeenCalledWith('in_123', {
      expand: ['subscription'],
    });
    expect(stripeClient.invoices.list).toHaveBeenCalledWith({ customer: 'cus_123', limit: 25 });
  });

  it('reads only the default payment method through Stripe Customer state', async () => {
    stripeClient.customers.create.mockResolvedValue({ id: 'unused' });
    stripeClient.paymentMethods.retrieve.mockResolvedValue({ id: 'pm_123', type: 'card' });
    stripeClient.customers.retrieve.mockResolvedValue({
      id: 'cus_123',
      deleted: false,
      invoice_settings: { default_payment_method: 'pm_123' },
    });
    const gateway = new StripeBillingGateway();

    await expect(gateway.retrieveDefaultPaymentMethod('cus_123')).resolves.toMatchObject({
      id: 'pm_123',
      type: 'card',
    });
    expect(stripeClient.customers.retrieve).toHaveBeenCalledWith('cus_123', {
      expand: ['invoice_settings.default_payment_method'],
    });
  });
});

function env() {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    WEB_APP_URL: 'http://localhost:3000',
    API_PUBLIC_URL: 'http://localhost:4000/api/v1',
    CORS_ORIGINS: 'http://localhost:3000',
    REQUEST_BODY_LIMIT: '1mb',
    DATABASE_URL: 'postgresql://user:pass@localhost:6432/db',
    DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_CACHE_URL: 'redis://localhost:6379',
    REDIS_QUEUE_URL: 'redis://localhost:6380',
    REDIS_REALTIME_URL: 'redis://localhost:6381',
    REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
    PUBLIC_API_KEY_RATE_LIMIT_PER_MINUTE: '120',
    PUBLIC_API_WORKSPACE_RATE_LIMIT_PER_MINUTE: '600',
    PUBLIC_API_IDEMPOTENCY_TTL_HOURS: '24',
    WEBHOOK_REQUEST_TIMEOUT_MS: '10000',
    WEBHOOK_DELIVERY_RETENTION_DAYS: '30',
    WEBHOOK_ALLOW_LOCAL_HTTP: 'false',
    INBOUND_WEBHOOK_MAX_BODY_BYTES: '262144',
    INBOUND_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: '300',
    INBOUND_WEBHOOK_SOURCE_RATE_LIMIT_PER_MINUTE: '120',
    INBOUND_WEBHOOK_WORKSPACE_RATE_LIMIT_PER_MINUTE: '600',
    INBOUND_WEBHOOK_EVENT_RETENTION_DAYS: '30',
    INTEGRATION_CONNECTION_LIMIT: '50',
    INTEGRATION_CONNECTION_RATE_LIMIT_PER_MINUTE: '120',
    INTEGRATION_WORKSPACE_RATE_LIMIT_PER_MINUTE: '600',
    INTEGRATION_ACTION_HISTORY_RETENTION_DAYS: '60',
    INTEGRATION_PROVIDER_RESPONSE_MAX_BYTES: '1048576',
    INTEGRATION_REQUEST_TIMEOUT_MS: '10000',
    STRIPE_SECRET_KEY: 'sk_test_12345678901234567890123456789012',
    STRIPE_WEBHOOK_SECRET: 'whsec_12345678901234567890123456789012',
    STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_test_123',
    STRIPE_WEBHOOK_MAX_BODY_BYTES: '262144',
    MINIO_ENDPOINT: 'localhost',
    MINIO_PORT: '9000',
    MINIO_USE_SSL: 'false',
    MINIO_ACCESS_KEY: 'zea-play-dev-minio-access',
    MINIO_SECRET_KEY: 'zea-play-dev-minio-secret-at-least-32-chars',
    MINIO_BUCKET: 'zea-play-dev',
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'no-reply@example.com',
    EMAIL_FROM_NAME: 'ZeaPlay',
    RESEND_API_KEY: 'test-resend-api-key',
    SMTP_HOST: '',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    OTP_PEPPER: 'test-otp-pepper-at-least-32-characters',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
  };
}
