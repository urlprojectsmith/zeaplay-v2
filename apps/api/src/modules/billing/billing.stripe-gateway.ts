import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import Stripe from 'stripe';

export interface StripeCustomerInput {
  name: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface StripeProductInput {
  name: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface StripeRecurringPriceInput {
  productId: string;
  currency: string;
  interval: 'month' | 'year';
  amountMinor: number;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface StripeCheckoutSessionInput {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
  idempotencyKey: string;
}

export interface StripePortalSessionInput {
  customerId: string;
  returnUrl: string;
  idempotencyKey: string;
}

export interface StripeSubscriptionUpgradeInput {
  subscriptionId: string;
  subscriptionItemId: string;
  priceId: string;
  idempotencyKey: string;
}

export interface StripeSubscriptionScheduleInput {
  subscriptionId: string;
  currentPriceId: string;
  priceId: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  idempotencyKey: string;
}

export interface StripeInvoiceListInput {
  customerId: string;
  limit: number;
}

@Injectable()
export class StripeBillingGateway {
  private readonly env = validateEnvironment(process.env);
  private readonly stripe = this.env.STRIPE_ENABLED ? new Stripe(this.env.STRIPE_SECRET_KEY) : null;

  get enabled() {
    return this.env.STRIPE_ENABLED;
  }

  async createCustomer(input: StripeCustomerInput) {
    return this.client().customers.create(
      {
        name: input.name,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async createProduct(input: StripeProductInput) {
    return this.client().products.create(
      {
        name: input.name,
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async createRecurringPrice(input: StripeRecurringPriceInput) {
    return this.client().prices.create(
      {
        product: input.productId,
        currency: input.currency.toLowerCase(),
        unit_amount: input.amountMinor,
        recurring: { interval: input.interval },
        metadata: input.metadata,
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async createCheckoutSession(input: StripeCheckoutSessionInput) {
    return this.client().checkout.sessions.create(
      {
        mode: 'subscription',
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.clientReferenceId,
        metadata: input.metadata,
        subscription_data: {
          metadata: input.metadata,
        },
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async createPortalSession(input: StripePortalSessionInput) {
    return this.client().billingPortal.sessions.create(
      {
        customer: input.customerId,
        configuration: this.env.STRIPE_PORTAL_CONFIGURATION_ID,
        return_url: input.returnUrl,
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async retrieveSubscription(subscriptionId: string) {
    return this.client().subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price', 'latest_invoice'],
    });
  }

  async retrieveInvoice(invoiceId: string) {
    return this.client().invoices.retrieve(invoiceId, {
      expand: ['subscription'],
    });
  }

  async listInvoices(input: StripeInvoiceListInput) {
    return this.client().invoices.list({
      customer: input.customerId,
      limit: input.limit,
    });
  }

  async retrieveDefaultPaymentMethod(customerId: string) {
    const customer = await this.client().customers.retrieve(customerId, {
      expand: ['invoice_settings.default_payment_method'],
    });
    if (customer.deleted) return null;
    const method = customer.invoice_settings?.default_payment_method;
    if (typeof method === 'string') {
      return this.client().paymentMethods.retrieve(method);
    }
    return method ?? null;
  }

  async updateSubscriptionForUpgrade(input: StripeSubscriptionUpgradeInput) {
    return this.client().subscriptions.update(
      input.subscriptionId,
      {
        items: [{ id: input.subscriptionItemId, price: input.priceId }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'pending_if_incomplete',
        expand: ['items.data.price', 'latest_invoice'],
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }

  async schedulePriceChange(input: StripeSubscriptionScheduleInput) {
    const schedule = await this.client().subscriptionSchedules.create(
      { from_subscription: input.subscriptionId },
      { idempotencyKey: `${input.idempotencyKey}:create` },
    );
    return this.client().subscriptionSchedules.update(
      schedule.id,
      {
        phases: [
          {
            start_date: Math.floor(input.currentPeriodStart.getTime() / 1000),
            end_date: Math.floor(input.currentPeriodEnd.getTime() / 1000),
            items: [{ price: input.currentPriceId, quantity: 1 }],
          },
          {
            start_date: Math.floor(input.currentPeriodEnd.getTime() / 1000),
            items: [{ price: input.priceId, quantity: 1 }],
          },
        ],
      },
      { idempotencyKey: `${input.idempotencyKey}:update` },
    );
  }

  async cancelAtPeriodEnd(subscriptionId: string, idempotencyKey: string) {
    return this.client().subscriptions.update(
      subscriptionId,
      { cancel_at_period_end: true },
      { idempotencyKey },
    );
  }

  async cancelImmediately(subscriptionId: string, idempotencyKey: string) {
    return this.client().subscriptions.cancel(subscriptionId, undefined, { idempotencyKey });
  }

  constructWebhookEvent(rawBody: Buffer, signature: string) {
    return this.client().webhooks.constructEvent(
      rawBody,
      signature,
      this.env.STRIPE_WEBHOOK_SECRET,
    );
  }

  private client() {
    if (!this.stripe) throw new ServiceUnavailableException('STRIPE_DISABLED');
    return this.stripe;
  }
}
