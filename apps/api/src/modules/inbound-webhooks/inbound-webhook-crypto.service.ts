import { Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  INBOUND_WEBHOOK_PUBLIC_ID_BYTES,
  INBOUND_WEBHOOK_SECRET_BYTES,
} from './inbound-webhooks.constants';

@Injectable()
export class InboundWebhookCryptoService {
  generatePublicIdentifier() {
    return `iw_${randomBytes(INBOUND_WEBHOOK_PUBLIC_ID_BYTES).toString('base64url')}`;
  }

  generateSecret() {
    return `ziwhsec_${randomBytes(INBOUND_WEBHOOK_SECRET_BYTES).toString('base64url')}`;
  }

  hashRawBody(rawBody: Buffer) {
    return createHash('sha256').update(rawBody).digest('hex');
  }

  sign(timestamp: string, rawBody: Buffer, secret: string) {
    const input = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
    return `v1=${createHmac('sha256', secret).update(input).digest('hex')}`;
  }

  verify(signature: string, timestamp: string, rawBody: Buffer, secret: string) {
    if (!/^v1=[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = this.sign(timestamp, rawBody, secret);
    const receivedBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    if (receivedBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(receivedBuffer, expectedBuffer);
  }
}
