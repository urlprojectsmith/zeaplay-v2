import { BadRequestException, Injectable } from '@nestjs/common';
import { CloudDriveTokenEncryptionService } from '../cloud-drives/cloud-drive-token-encryption.service';
import type { IntegrationCredentialPayload } from './integration.types';

@Injectable()
export class IntegrationCredentialService {
  constructor(private readonly encryption: CloudDriveTokenEncryptionService) {}

  isConfigured() {
    return this.encryption.isConfigured();
  }

  encrypt(credentials: Record<string, unknown>) {
    const normalized = normalizeCredentials(credentials);
    return this.encryption.encrypt(JSON.stringify(normalized));
  }

  decrypt(payload: string | null): IntegrationCredentialPayload {
    if (!payload) throw new BadRequestException('INTEGRATION_CREDENTIALS_MISSING');
    const parsed = JSON.parse(this.encryption.decrypt(payload));
    return normalizeCredentials(parsed as Record<string, unknown>);
  }
}

function normalizeCredentials(value: Record<string, unknown>): IntegrationCredentialPayload {
  const credentials: IntegrationCredentialPayload = {};
  for (const key of [
    'accessToken',
    'refreshToken',
    'expiresAt',
    'token',
    'apiKey',
    'apiKeyHeaderName',
    'username',
    'password',
  ] as const) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) credentials[key] = candidate.trim();
  }
  if (Array.isArray(value.scopes)) {
    credentials.scopes = value.scopes.filter((scope): scope is string => typeof scope === 'string');
  }
  return credentials;
}
