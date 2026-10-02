import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages, translate } from '../lib/i18n';
import { defaultPublicBranding, publicBrandToTokens } from '../services/public-branding.shared';

const root = join(__dirname, '..');

describe('Phase 18.3 public branding UI', () => {
  it('resolves auth-page branding on the server from the incoming host', () => {
    for (const route of [
      'app/(public)/login/page.tsx',
      'app/(public)/forgot-password/page.tsx',
      'app/(public)/reset-password/page.tsx',
      'app/(public)/invite/page.tsx',
      'app/(public)/verify-otp/page.tsx',
    ]) {
      const source = read(route);
      expect(source).toContain('getPublicBrandingForRequest');
      expect(source).toContain('PublicBrandShell');
      expect(source).toContain('generateMetadata');
    }
  });

  it('keeps client components away from the server-only host helper', () => {
    expect(read('services/public-branding.ts')).toContain("from 'next/headers'");
    expect(read('components/branding/PublicBrandShell.tsx')).toContain(
      "from '../../services/public-branding.shared'",
    );
    expect(read('components/branding/PublicBrandShell.tsx')).not.toContain(
      "from '../../services/public-branding'",
    );
  });

  it('applies public resource branding for Docs and Forms after public lookup succeeds', () => {
    expect(read('components/workspace/docs/PublicDocSharePage.tsx')).toContain(
      'shareQuery.data.branding',
    );
    expect(read('components/workspace/forms/PublicFormPage.tsx')).toContain(
      'formQuery.data.branding',
    );
    expect(read('services/workspace-docs.ts')).toContain('branding: PublicBranding');
    expect(read('services/workspace-forms.ts')).toContain('branding: PublicBranding');
  });

  it('maps public branding into safe BrandProvider tokens', () => {
    expect(publicBrandToTokens(defaultPublicBranding)).toEqual(
      expect.objectContaining({
        brandName: 'Zea Play',
        agencyName: 'Zea Play',
        primaryColor: '#1F7A68',
        accentColor: '#7C3AED',
      }),
    );
  });

  it('keeps public/auth branding strings localized in supported locales', () => {
    expect(translate('en', 'publicBranding.signInTitle')).toBe('Sign in');
    expect(translate('ta', 'publicBranding.signInTitle')).toBe(
      messages.ta.publicBranding.signInTitle,
    );
    expect(messages.ta.publicBranding.signInTitle).not.toBe(messages.en.publicBranding.signInTitle);
    for (const sourcePath of [
      'components/auth/login-form.tsx',
      'components/auth/verify-otp-form.tsx',
      'components/branding/PublicBrandShell.tsx',
      'components/workspace/docs/PublicDocSharePage.tsx',
      'components/workspace/forms/PublicFormPage.tsx',
    ]) {
      expect(read(sourcePath)).toContain('publicBranding.');
    }
  });

  it('keeps public branding surfaces accessible without leaking private helpers', () => {
    expect(read('components/branding/BrandLogo.tsx')).toContain('alt={`${brandName} logo`}');
    expect(read('components/workspace/docs/PublicDocSharePage.tsx')).toContain(
      "label={t(locale, 'publicBranding.password')}",
    );
    expect(read('components/workspace/forms/PublicFormPage.tsx')).toContain('aria-live="polite"');
    expect(read('components/workspace/forms/PublicFormPage.tsx')).toContain('role="alert"');
  });
});

function read(path: string) {
  return readFileSync(join(root, path), 'utf8');
}
