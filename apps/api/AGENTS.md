# apps/api

API HTTP + worker. Lee primero el `AGENTS.md` de la raíz y `docs/architecture.md`.

- Módulos de referencia: `src/modules/employees/` (completo) y `src/modules/organization/`.
- Crear módulo → skill `new-module`. Agregar endpoint → skill `new-use-case`. Esquema → skill `db-change`.
- Composition root: `src/container.ts` (módulos activos + cradle). Entrypoints: `src/main/http.ts`, `src/main/worker.ts`.
- Prisma 7: `prisma.config.ts`, schema en `prisma/schema.prisma`, cliente generado en
  `src/infrastructure/database/generated/` (no versionado; `pnpm db:generate`).
- Alias `@/` = `src/`. Imports entre capas del MISMO módulo: relativos. Otros módulos: `@/modules/<x>` (index).
- `pnpm arch:check` debe pasar siempre. Adaptadores Prisma: `pnpm test:integration` (base `*_test`).
- Proceso (planes, roles, fast lane): `docs/harness/`.
