import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '../contexts/providers';

export const metadata: Metadata = {
  applicationName: 'Zea Play',
  title: 'Zea Play',
  description: 'Zea Play SaaS foundation',
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/icons/zeaplay-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/zeaplay-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/zeaplay-icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Zea Play',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#1F7A68' },
    { media: '(prefers-color-scheme: dark)', color: '#123C35' },
  ],
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
