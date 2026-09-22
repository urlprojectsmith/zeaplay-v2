export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendSecurityOtpInput {
  to: string;
  code: string;
  expiresInMinutes: number;
}

export interface MailProvider {
  send(input: SendMailInput): Promise<void>;
}

export class MailDeliveryError extends Error {
  constructor() {
    super('MAIL_DELIVERY_FAILED');
  }
}
