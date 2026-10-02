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
  brand?: MailBrandingInput;
}

export interface MailProvider {
  send(input: SendMailInput): Promise<void>;
}

export interface MailBrandingInput {
  appName?: string;
  companyName?: string;
  logo?: { url?: string | null } | null;
  primaryColor?: string;
  accentColor?: string;
  footerText?: string;
  supportEmail?: string;
  supportUrl?: string;
}

export class MailDeliveryError extends Error {
  constructor() {
    super('MAIL_DELIVERY_FAILED');
  }
}
