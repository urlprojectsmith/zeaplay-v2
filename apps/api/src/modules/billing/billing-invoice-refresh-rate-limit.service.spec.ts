import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { BillingInvoiceRefreshRateLimitService } from './billing-invoice-refresh-rate-limit.service';

describe('BillingInvoiceRefreshRateLimitService', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('rate limits manual invoice refresh by Super Agency and user buckets', async () => {
    const multi = jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 6]]),
    }));
    const service = new BillingInvoiceRefreshRateLimitService({
      rateLimit: { multi },
    } as never);

    await expect(service.assertWithinLimit('super-agency-1', 'user-1')).rejects.toThrow(
      HttpException,
    );
    expect(multi).toHaveBeenCalledTimes(2);
  });

  it('uses bounded fallback outside production when Redis is unavailable', async () => {
    process.env.NODE_ENV = 'test';
    const service = new BillingInvoiceRefreshRateLimitService({
      rateLimit: {
        multi: jest.fn(() => {
          throw new Error('redis down');
        }),
      },
    } as never);

    for (let index = 0; index < 5; index += 1) {
      await expect(service.assertWithinLimit('super-agency-1', 'user-1')).resolves.toBeUndefined();
    }
    await expect(service.assertWithinLimit('super-agency-1', 'user-1')).rejects.toThrow(
      HttpException,
    );
  });

  it('rate limits checkout actions independently from invoice refresh buckets', async () => {
    process.env.NODE_ENV = 'test';
    const service = new BillingInvoiceRefreshRateLimitService({
      rateLimit: {
        multi: jest.fn(() => {
          throw new Error('redis down');
        }),
      },
    } as never);

    for (let index = 0; index < 3; index += 1) {
      await expect(
        service.assertActionWithinLimit('checkout', 'super-agency-1', 'user-1'),
      ).resolves.toBeUndefined();
    }
    await expect(
      service.assertActionWithinLimit('checkout', 'super-agency-1', 'user-1'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'BILLING_ACTION_RATE_LIMITED' }),
    });

    await expect(service.assertWithinLimit('super-agency-1', 'user-1')).resolves.toBeUndefined();
  });

  it('fails closed in production when Redis rate limiting is unavailable', async () => {
    process.env.NODE_ENV = 'production';
    const service = new BillingInvoiceRefreshRateLimitService({
      rateLimit: {
        multi: jest.fn(() => {
          throw new Error('redis down');
        }),
      },
    } as never);

    await expect(service.assertWithinLimit('super-agency-1', 'user-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
