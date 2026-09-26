import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Los paquetes internos se publican como TypeScript fuente: Next los compila.
  transpilePackages: ['@rrhh/api-client', '@rrhh/contracts', '@rrhh/domain'],
  // Build autocontenido para Docker; el tracing parte desde la raíz del monorepo.
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
