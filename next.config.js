// Open Backup UI v1.0.2
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Using top-level turbopack key as experimental.turbo is deprecated
  turbopack: {
    root: __dirname,
  }
};

module.exports = nextConfig;
