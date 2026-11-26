/** @type {import('next').NextConfig} */
const isNativeBuild = process.env.BUILD_TARGET === 'NATIVE';

const nextConfig = {
  experimental: {
    externalDir: true,
    serverComponentsExternalPackages: ['pg', 'firebase-admin', 'ws', '@google/genai'],
  },
  ...(isNativeBuild
    ? { output: 'export', images: { unoptimized: true } }
    : { images: { unoptimized: true } }),
};

export default nextConfig;
