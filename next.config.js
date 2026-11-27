// Open Backup UI v1.3.0
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: {
    '/api/vbm/recovery': ['lib/vbm-recovery/read-msg-body.cjs','node_modules/@kenjiuno/msgreader/**/*','node_modules/@kenjiuno/decompressrtf/**/*','node_modules/iconv-lite/**/*','node_modules/safer-buffer/**/*'],
  },
  async redirects() {
    return [
      { source: '/administration', destination: '/settings', permanent: true },
      { source: '/administration/settings', destination: '/settings', permanent: true },
      { source: '/administration/:section(licensing|data-sources|branding|ai-settings|telemetry)', destination: '/settings/:section', permanent: true },
      { source: '/administration/identity/:view(users|roles)', destination: '/settings/identity/:view', permanent: true },
      { source: '/administration/identity', destination: '/settings/identity/users', permanent: true },
      { source: '/settings/identity', destination: '/settings/identity/users', permanent: true },
      { source: '/dashboard/licenses', destination: '/settings/licensing', permanent: true },
      { source: '/dashboards/licenses', destination: '/settings/licensing', permanent: true },
    ]
  },
  // Using top-level turbopack key as experimental.turbo is deprecated
  turbopack: {
    root: __dirname,
  }
};

module.exports = nextConfig;
