import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import type { Environment } from '@zea-play/config';
import { MailService } from './mail.service';
import { MailDeliveryError } from './mail.types';
import { ResendMailProvider } from './resend-mail.provider';
import { SmtpMailProvider } from './smtp-mail.provider';

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: jest.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null }) },
  })),
}));

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: jest.fn().mockReturnValue({
      sendMail: jest.fn().mockResolvedValue({ messageId: 'smtp-1' }),
    }),
  },
}));

describe('Mail providers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...process.env,
      ...baseProcessEnv(),
    };
  });

  it('sends security mail through Resend with safe configured fields', async () => {
    const provider = new ResendMailProvider(baseEnv());

    await provider.send({
      to: 'owner@zeaplay.test',
      subject: 'ZeaPlay security verification code',
      text: 'Security code body',
    });

    const resendInstance = (Resend as jest.Mock).mock.results[0]?.value;
    expect(Resend).toHaveBeenCalledWith('test-resend-api-key');
    expect(resendInstance.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'ZeaPlay <no-reply@example.com>',
        to: 'owner@zeaplay.test',
        subject: 'ZeaPlay security verification code',
        text: 'Security code body',
      }),
    );
  });

  it('normalizes Resend provider errors', async () => {
    const provider = new ResendMailProvider(baseEnv());
    const resendInstance = (Resend as jest.Mock).mock.results[0]?.value;
    resendInstance.emails.send.mockRejectedValueOnce(new Error('provider secret detail'));

    await expect(
      provider.send({ to: 'owner@zeaplay.test', subject: 'Subject', text: 'Body' }),
    ).rejects.toThrow(MailDeliveryError);
  });

  it('sends security mail through SMTP with a reused configured transporter', async () => {
    const env = { ...baseEnv(), EMAIL_PROVIDER: 'smtp' as const, SMTP_HOST: 'smtp.example.com' };
    const provider = new SmtpMailProvider(env);

    await provider.send({
      to: 'owner@zeaplay.test',
      subject: 'ZeaPlay security verification code',
      text: 'Security code body',
    });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        port: 587,
        secure: false,
      }),
    );
    const transporter = (nodemailer.createTransport as jest.Mock).mock.results[0]?.value;
    expect(transporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'ZeaPlay <no-reply@example.com>',
        to: 'owner@zeaplay.test',
        subject: 'ZeaPlay security verification code',
      }),
    );
  });

  it('selects exactly one configured provider and does not fail over', async () => {
    process.env.EMAIL_PROVIDER = 'resend';
    const service = new MailService();
    const resendInstance = (Resend as jest.Mock).mock.results[0]?.value;
    resendInstance.emails.send.mockRejectedValueOnce(new Error('resend unavailable'));

    await expect(
      service.sendSecurityOtp({ to: 'owner@zeaplay.test', code: '123456', expiresInMinutes: 5 }),
    ).rejects.toThrow(MailDeliveryError);

    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
});

function baseEnv(): Environment {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    WEB_PORT: 3000,
    API_PORT: 4000,
    WORKER_PORT: 4001,
    WEB_APP_URL: 'http://localhost:3000',
    API_PUBLIC_URL: 'http://localhost:4000/api/v1',
    CORS_ORIGINS: 'http://localhost:3000',
    REQUEST_BODY_LIMIT: '1mb',
    DATABASE_URL: 'postgresql://user:pass@localhost:6432/db',
    DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_CACHE_URL: 'redis://localhost:6379',
    REDIS_QUEUE_URL: 'redis://localhost:6380',
    REDIS_REALTIME_URL: 'redis://localhost:6381',
    REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
    ACCESS_TOKEN_TTL_SECONDS: 900,
    REFRESH_TOKEN_TTL_SECONDS: 2_592_000,
    REFRESH_TOKEN_COOKIE_NAME: 'zea_refresh',
    CSRF_COOKIE_NAME: 'zea_csrf',
    AUTH_COOKIE_DOMAIN: '',
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: 900,
    LOGIN_RATE_LIMIT_MAX_ATTEMPTS: 5,
    MAX_UPLOAD_BYTES: 52_428_800,
    ALLOWED_MIME_TYPES: 'image/png,image/jpeg,image/webp,application/pdf,text/plain',
    UPLOAD_URL_TTL_SECONDS: 300,
    DOWNLOAD_URL_TTL_SECONDS: 300,
    DEFAULT_STORAGE_LIMIT_BYTES: 1_073_741_824,
    MINIO_ENDPOINT: 'localhost',
    MINIO_PORT: 9000,
    MINIO_USE_SSL: false,
    MINIO_ACCESS_KEY: 'zea-play-dev-minio-access',
    MINIO_SECRET_KEY: 'zea-play-dev-minio-secret-at-least-32-chars',
    MINIO_BUCKET: 'zea-play-dev',
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'no-reply@example.com',
    EMAIL_FROM_NAME: 'ZeaPlay',
    RESEND_API_KEY: 'test-resend-api-key',
    SMTP_HOST: '',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    OTP_PEPPER: 'test-otp-pepper-at-least-32-characters',
    OTP_TTL_SECONDS: 300,
    OTP_MAX_VERIFY_ATTEMPTS: 5,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
    OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: 900,
    OTP_SEND_RATE_LIMIT_MAX: 3,
    OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: 900,
    OTP_VERIFY_RATE_LIMIT_MAX: 10,
    SENTRY_DSN: '',
    NEXT_PUBLIC_SENTRY_DSN: '',
    OTEL_SERVICE_NAME: 'zea-play',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
  };
}

function baseProcessEnv() {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    WEB_APP_URL: 'http://localhost:3000',
    API_PUBLIC_URL: 'http://localhost:4000/api/v1',
    CORS_ORIGINS: 'http://localhost:3000',
    REQUEST_BODY_LIMIT: '1mb',
    DATABASE_URL: 'postgresql://user:pass@localhost:6432/db',
    DIRECT_DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    REDIS_CACHE_URL: 'redis://localhost:6379',
    REDIS_QUEUE_URL: 'redis://localhost:6380',
    REDIS_REALTIME_URL: 'redis://localhost:6381',
    REDIS_RATE_LIMIT_URL: 'redis://localhost:6382',
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters',
    MINIO_ENDPOINT: 'localhost',
    MINIO_PORT: '9000',
    MINIO_USE_SSL: 'false',
    MINIO_ACCESS_KEY: 'zea-play-dev-minio-access',
    MINIO_SECRET_KEY: 'zea-play-dev-minio-secret-at-least-32-chars',
    MINIO_BUCKET: 'zea-play-dev',
    EMAIL_PROVIDER: 'resend',
    EMAIL_FROM: 'no-reply@example.com',
    EMAIL_FROM_NAME: 'ZeaPlay',
    RESEND_API_KEY: 'test-resend-api-key',
    SMTP_HOST: '',
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
    OTP_PEPPER: 'test-otp-pepper-at-least-32-characters',
    OTP_TTL_SECONDS: '300',
    OTP_MAX_VERIFY_ATTEMPTS: '5',
    OTP_RESEND_COOLDOWN_SECONDS: '60',
    OTP_SEND_RATE_LIMIT_WINDOW_SECONDS: '900',
    OTP_SEND_RATE_LIMIT_MAX: '3',
    OTP_VERIFY_RATE_LIMIT_WINDOW_SECONDS: '900',
    OTP_VERIFY_RATE_LIMIT_MAX: '10',
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
  };
}
