import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { Environment } from '@zea-play/config';
import { MailDeliveryError, type MailProvider, type SendMailInput } from './mail.types';

export class SmtpMailProvider implements MailProvider {
  private readonly transporter: Transporter<SMTPTransport.SentMessageInfo>;

  constructor(private readonly env: Environment) {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  }

  async send(input: SendMailInput) {
    try {
      await this.transporter.sendMail({
        from: formatFrom(this.env.EMAIL_FROM, this.env.EMAIL_FROM_NAME),
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
    } catch {
      throw new MailDeliveryError();
    }
  }
}

function formatFrom(email: string, name: string) {
  return `${name.replace(/[<>\r\n]/g, '').trim()} <${email}>`;
}
