/** @type {import('next').NextConfig} */
const isNativeBuild = process.env.BUILD_TARGET === 'NATIVE';

const nextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      canvas: false,
    };
    return config;
  },
  ...(isNativeBuild
    ? { output: 'export', trailingSlash: true, images: { unoptimized: true } }
    : { images: { unoptimized: true } }),
};

export default nextConfig;
