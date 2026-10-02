import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from './(public)/login/page';
import { defaultPublicBranding } from '../services/public-branding.shared';
import { LanguageProvider } from '../contexts/language-provider';

vi.mock('../services/public-branding', () => ({
  getPublicBrandingForRequest: vi.fn(() => Promise.resolve(defaultPublicBranding)),
}));

describe('web smoke', () => {
  it('renders the login foundation route', async () => {
    render(<LanguageProvider>{await LoginPage()}</LanguageProvider>);
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
