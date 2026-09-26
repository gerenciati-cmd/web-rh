import { defineConfig } from 'prisma/config';

// Prisma 7 no carga .env por sí solo.
try {
  process.loadEnvFile();
} catch {
  // Sin .env (CI/Docker/producción): las variables vienen del entorno.
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // `prisma generate` no necesita BD (CI, build de Docker); migrate/studio sí la exigen.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
