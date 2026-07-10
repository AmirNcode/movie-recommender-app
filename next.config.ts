/**
 * Next.js configuration for Filmmoo.
 *
 * Key decisions:
 * - output: 'standalone' for containerized deployments (AI Studio / Cloud Run)
 * - turbopack: {} to acknowledge Next.js 16 Turbopack default while keeping
 *   the webpack fallback for the HMR-disable behavior used by AI Studio
 * - transpilePackages: ['motion'] to ensure the motion library is bundled correctly
 */
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: false,
  },
  // Allow access to remote images (placeholders and TMDB movie posters).
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
      {
        protocol: 'https',
        hostname: 'image.tmdb.org',
        port: '',
        pathname: '/t/p/**', // TMDB poster paths follow /t/p/{size}/{hash}
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  // Next.js 16 uses Turbopack by default. An empty config here tells it to
  // accept the webpack fallback below without erroring during builds.
  turbopack: {
    root: process.cwd(),
  },
  webpack: (config, { dev }) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modify — file watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
