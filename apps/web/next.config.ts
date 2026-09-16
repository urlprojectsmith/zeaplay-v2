import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: [
    '@zea-play/api-client',
    '@zea-play/types',
    '@zea-play/ui',
    '@zea-play/validation',
  ],
};

export default nextConfig;
