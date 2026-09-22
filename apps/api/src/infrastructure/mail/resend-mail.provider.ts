import { Resend } from 'resend';
import type { Environment } from '@zea-play/config';
import { MailDeliveryError, type MailProvider, type SendMailInput } from './mail.types';

export class ResendMailProvider implements MailProvider {
  private readonly resend: Resend;

  constructor(private readonly env: Environment) {
    this.resend = new Resend(env.RESEND_API_KEY);
  }

  async send(input: SendMailInput) {
    try {
      const result = await this.resend.emails.send({
        from: formatFrom(this.env.EMAIL_FROM, this.env.EMAIL_FROM_NAME),
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      if (result.error) throw new Error('RESEND_DELIVERY_FAILED');
    } catch {
      throw new MailDeliveryError();
    }
  }
}

function formatFrom(email: string, name: string) {
  return `${name.replace(/[<>\r\n]/g, '').trim()} <${email}>`;
}
