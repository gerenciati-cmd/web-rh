import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/** Tests de adaptadores Prisma contra Postgres real (base *_test). `pnpm test:integration`. */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    fileParallelism: false,
    env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' },
  },
});
