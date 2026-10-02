import { Injectable } from '@nestjs/common';
import { validateEnvironment } from '@zea-play/config';
import { ResendMailProvider } from './resend-mail.provider';
import { SmtpMailProvider } from './smtp-mail.provider';
import type {
  MailBrandingInput,
  MailProvider,
  SendMailInput,
  SendSecurityOtpInput,
} from './mail.types';

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
    const brand = normalizeMailBrand(input.brand);
    const subject = `${brand.appName} security verification code`;
    const text = [
      `Your ${brand.appName} verification code is ${input.code}.`,
      `It expires in ${input.expiresInMinutes} minutes.`,
      'Purpose: privileged Gamification reset.',
      'If you did not request this, do not share or use this code.',
      brand.footerText,
      `Support: ${brand.supportEmail}${brand.supportUrl ? ` (${brand.supportUrl})` : ''}`,
    ].join('\n');
    const html = brandedMailHtml(brand, [
      `<p>Your ${escapeHtml(brand.appName)} verification code is:</p>`,
      `<p><strong style="font-size: 24px; letter-spacing: 4px; color: ${brand.primaryColor};">${input.code}</strong></p>`,
      `<p>It expires in ${input.expiresInMinutes} minutes.</p>`,
      '<p>Purpose: privileged Gamification reset.</p>',
      '<p>If you did not request this, do not share or use this code.</p>',
    ]);
    return this.send({ to: input.to, subject, text, html });
  }
}

export function normalizeMailBrand(input: MailBrandingInput | undefined) {
  return {
    appName: safeText(input?.appName, 'ZeaPlay', 80),
    companyName: safeText(input?.companyName, 'ZeaPlay', 120),
    logoUrl: safeImageUrl(input?.logo?.url),
    primaryColor: safeColor(input?.primaryColor, '#1F7A68'),
    accentColor: safeColor(input?.accentColor, '#7C3AED'),
    footerText: safeText(input?.footerText, 'Powered by ZeaPlay', 160),
    supportEmail: safeText(input?.supportEmail, 'support@zeaplay.test', 320),
    supportUrl: safeHttpsUrl(input?.supportUrl),
  };
}

export function brandedMailHtml(brand: ReturnType<typeof normalizeMailBrand>, body: string[]) {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.companyName)}" style="max-width: 160px; max-height: 48px; object-fit: contain;">`
    : `<strong>${escapeHtml(brand.companyName)}</strong>`;
  const support = brand.supportUrl
    ? `<a href="${escapeHtml(brand.supportUrl)}">${escapeHtml(brand.supportEmail)}</a>`
    : escapeHtml(brand.supportEmail);
  return [
    '<div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">',
    `<div style="border-bottom: 3px solid ${brand.accentColor}; padding-bottom: 12px; margin-bottom: 18px;">${logo}</div>`,
    ...body,
    `<p style="color: #4b5563; font-size: 12px; margin-top: 24px;">${escapeHtml(brand.footerText)}</p>`,
    `<p style="color: #4b5563; font-size: 12px;">Support: ${support}</p>`,
    '</div>',
  ].join('');
}

function safeText(value: string | undefined, fallback: string, max: number) {
  const trimmed = value?.trim().replace(/\s+/g, ' ') ?? '';
  if (!trimmed || /[<>]/.test(trimmed) || /javascript:/i.test(trimmed)) return fallback;
  return trimmed.slice(0, max);
}

function safeColor(value: string | undefined, fallback: string) {
  return value && /^#[0-9A-F]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

function safeHttpsUrl(value: string | undefined) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function safeImageUrl(value: string | null | undefined) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
