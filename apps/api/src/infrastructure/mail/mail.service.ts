import { Injectable } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import { ResendMailProvider } from './resend-mail.provider';
import { SmtpMailProvider } from './smtp-mail.provider';
import type { MailProvider, SendMailInput, SendSecurityOtpInput } from './mail.types';

@Injectable()
export class MailService {
  private readonly provider: MailProvider;

  constructor() {
    const env = validateEnvironment(process.env);
    this.provider =
      env.EMAIL_PROVIDER === 'smtp' ? new SmtpMailProvider(env) : new ResendMailProvider(env);
  }

  send(input: SendMailInput) {
    return this.provider.send(input);
  }

  sendSecurityOtp(input: SendSecurityOtpInput) {
    const subject = 'ZeaPlay security verification code';
    const text = [
      `Your ZeaPlay verification code is ${input.code}.`,
      `It expires in ${input.expiresInMinutes} minutes.`,
      'Purpose: privileged Gamification reset.',
      'If you did not request this, do not share or use this code.',
    ].join('\n');
    const html = [
      '<p>Your ZeaPlay verification code is:</p>',
      `<p><strong style="font-size: 24px; letter-spacing: 4px;">${input.code}</strong></p>`,
      `<p>It expires in ${input.expiresInMinutes} minutes.</p>`,
      '<p>Purpose: privileged Gamification reset.</p>',
      '<p>If you did not request this, do not share or use this code.</p>',
    ].join('');
    return this.send({ to: input.to, subject, text, html });
  }
}
