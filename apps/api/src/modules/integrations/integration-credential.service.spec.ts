import { CloudDriveTokenEncryptionService } from '../cloud-drives/cloud-drive-token-encryption.service';
import { IntegrationCredentialService } from './integration-credential.service';

describe('IntegrationCredentialService', () => {
  const previousKey = process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = 'integration-test-secret-at-least-32-characters';
  });

  afterAll(() => {
    process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY = previousKey;
  });

  it('encrypts and decrypts credentials without returning plaintext storage', () => {
    const service = new IntegrationCredentialService(new CloudDriveTokenEncryptionService());

    const encrypted = service.encrypt({
      token: 'provider-token',
      refreshToken: 'refresh-token',
      scopes: ['chat:write'],
    });

    expect(encrypted).not.toContain('provider-token');
    expect(service.decrypt(encrypted)).toEqual({
      token: 'provider-token',
      refreshToken: 'refresh-token',
      scopes: ['chat:write'],
    });
  });
});
