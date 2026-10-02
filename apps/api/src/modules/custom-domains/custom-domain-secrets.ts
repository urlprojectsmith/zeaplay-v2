import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function createVerificationToken() {
  return randomBytes(32).toString('base64url');
}

export function hashVerificationToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function timingSafeHashEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function formatTxtRecordValue(token: string) {
  return `zea-verification=${token}`;
}

export function extractVerificationToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith('zea-verification=')) return null;
  return trimmed.slice('zea-verification='.length).trim();
}
