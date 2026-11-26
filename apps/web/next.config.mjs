/** @type {import('next').NextConfig} */
const isNativeBuild = process.env.BUILD_TARGET === 'NATIVE';

const nextConfig = {
  ...(isNativeBuild
    ? { output: 'export', images: { unoptimized: true } }
    : { output: 'standalone', images: { unoptimized: true } }),
};

export default nextConfig;
