import { BadRequestException } from '@nestjs/common';
import { WebhookUrlValidatorService } from '../webhooks/webhook-url-validator.service';
import { IntegrationGenericRestSecurityService } from './integration-generic-rest-security.service';

describe('IntegrationGenericRestSecurityService', () => {
  const service = new IntegrationGenericRestSecurityService(new WebhookUrlValidatorService());

  it('rejects absolute and traversal paths at action time', () => {
    expect(() => service.validateRelativePath('https://example.com/escape')).toThrow(
      BadRequestException,
    );
    expect(() => service.validateRelativePath('/../admin')).toThrow(BadRequestException);
    expect(() => service.validateRelativePath('/%2e%2e/admin')).toThrow(BadRequestException);
  });

  it('rejects restricted credential header names', () => {
    expect(() => service.validateCredentialHeaderName('Authorization')).toThrow(
      BadRequestException,
    );
    expect(() => service.validateCredentialHeaderName('Cookie')).toThrow(BadRequestException);
    expect(service.validateCredentialHeaderName('X-Partner-Key')).toBe('X-Partner-Key');
  });
});
