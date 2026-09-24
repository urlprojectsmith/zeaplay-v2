import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class CloudDriveTokenEncryptionService {
  isConfigured() {
    return Boolean(this.resolveKey());
  }

  encrypt(plaintext: string) {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return [
      VERSION,
      iv.toString('base64url'),
      authTag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  decrypt(payload: string) {
    const key = this.requireKey();
    const [version, iv, authTag, ciphertext] = payload.split('.');
    if (version !== VERSION || !iv || !authTag || !ciphertext) {
      throw new ServiceUnavailableException('CLOUD_TOKEN_ENCRYPTION_INVALID');
    }
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private requireKey() {
    const key = this.resolveKey();
    if (!key) throw new ServiceUnavailableException('CLOUD_TOKEN_ENCRYPTION_NOT_CONFIGURED');
    return key;
  }

  private resolveKey() {
    const value = process.env.CLOUD_DRIVE_TOKEN_ENCRYPTION_KEY?.trim();
    if (!value) return null;
    if (/^[A-Za-z0-9_-]{43,44}$/.test(value)) {
      const decoded = Buffer.from(value, 'base64url');
      if (decoded.length === 32) return decoded;
    }
    if (/^[A-Fa-f0-9]{64}$/.test(value)) {
      return Buffer.from(value, 'hex');
    }
    if (value.length >= 32) {
      return createHash('sha256').update(value).digest();
    }
    return null;
  }
}
