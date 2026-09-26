import {
  Injectable,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

@Injectable()
export class FormsCaptchaService {
  verifyIfRequired(settings: Record<string, unknown>, token?: string) {
    if (!settings.captchaRequired) return { verified: false, required: false };
    if (!token) throw new UnprocessableEntityException('FORM_CAPTCHA_REQUIRED');

    // Phase 16.2 defines the adapter boundary but does not wire a live CAPTCHA provider.
    throw new ServiceUnavailableException('FORM_CAPTCHA_PROVIDER_UNAVAILABLE');
  }
}
