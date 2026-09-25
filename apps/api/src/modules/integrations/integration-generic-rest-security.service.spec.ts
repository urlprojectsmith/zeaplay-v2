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
    expect(() => service.validateRelativePath('/%252e%252e/admin')).toThrow(BadRequestException);
    expect(() => service.validateRelativePath('/%E0%A4%A')).toThrow(BadRequestException);
    expect(() => service.validateRelativePath('//evil.example/path')).toThrow(BadRequestException);
    expect(() => service.validateRelativePath('/safe\\evil')).toThrow(BadRequestException);
  });

  it('rejects restricted credential header names', () => {
    expect(() => service.validateCredentialHeaderName('Authorization')).toThrow(
      BadRequestException,
    );
    expect(() => service.validateCredentialHeaderName('Cookie')).toThrow(BadRequestException);
    expect(() => service.validateCredentialHeaderName('Set-Cookie')).toThrow(BadRequestException);
    expect(() => service.validateCredentialHeaderName('Proxy-Authenticate')).toThrow(
      BadRequestException,
    );
    expect(() => service.validateCredentialHeaderName('Bad\r\nHeader')).toThrow(
      BadRequestException,
    );
    expect(service.validateCredentialHeaderName('X-Partner-Key')).toBe('X-Partner-Key');
  });

  it('bounds query parameters and JSON bodies', () => {
    expect(service.validateQuery({ page: 1 })).toEqual({ page: '1' });
    expect(() =>
      service.validateQuery(
        Object.fromEntries(Array.from({ length: 26 }, (_, index) => [`k${index}`, 'v'])),
      ),
    ).toThrow(BadRequestException);
    expect(() => service.validateQuery({ ['k'.repeat(81)]: 'v' })).toThrow(BadRequestException);
    expect(() => service.validateQuery({ key: 'v'.repeat(501) })).toThrow(BadRequestException);
    expect(() => service.validateJsonBody('raw-string')).toThrow(BadRequestException);
    expect(() => service.validateJsonBody({ payload: 'x'.repeat(262_145) })).toThrow(
      BadRequestException,
    );
  });

  it('builds same-origin URLs only', () => {
    expect(service.buildUrl('https://api.example.com', '/v1/items', { page: 1 })).toBe(
      'https://api.example.com/v1/items?page=1',
    );
    expect(() => service.buildUrl('https://api.example.com', '//evil.example/a', {})).toThrow(
      BadRequestException,
    );
  });
});
