import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: [
    '@zea-play/api-client',
    '@zea-play/types',
    '@zea-play/ui',
    '@zea-play/validation',
  ],
};

export default nextConfig;
