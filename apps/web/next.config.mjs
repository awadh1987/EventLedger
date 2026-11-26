/** @type {import('next').NextConfig} */
const isNativeBuild = process.env.BUILD_TARGET === 'NATIVE';

const nextConfig = {
  ...(isNativeBuild
    ? { output: 'export', images: { unoptimized: true } }
    : { images: { unoptimized: true } }),
};

export default nextConfig;
