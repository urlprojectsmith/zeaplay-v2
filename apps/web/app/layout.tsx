import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '../contexts/providers';

export const metadata: Metadata = {
  title: 'Zea Play',
  description: 'Zea Play SaaS foundation',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
