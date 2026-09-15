import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '../contexts/providers';

export const metadata: Metadata = {
  title: 'Zea Play',
  description: 'Zea Play SaaS foundation',
};

const preferenceScript = `
(() => {
  try {
    const theme = localStorage.getItem('zea-play-theme');
    const resolvedTheme = ['light', 'dark', 'colorful'].includes(theme)
      ? theme
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    const locale = localStorage.getItem('zea-play-locale');
    if (['en', 'ta'].includes(locale)) document.documentElement.lang = locale;
  } catch {
    document.documentElement.dataset.theme = 'light';
  }
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: preferenceScript }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
