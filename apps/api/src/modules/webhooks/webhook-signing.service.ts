import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { WEBHOOK_SECRET_BYTES } from './webhooks.constants';

@Injectable()
export class WebhookSigningService {
  generateSecret() {
    return `whsec_${randomBytes(WEBHOOK_SECRET_BYTES).toString('base64url')}`;
  }

  sign(secret: string, timestamp: string, rawBody: string) {
    return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  }
}
