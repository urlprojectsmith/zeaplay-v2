import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  transpilePackages: [
    '@zea-play/api-client',
    '@zea-play/types',
    '@zea-play/ui',
    '@zea-play/validation',
  ],
};

export default nextConfig;
