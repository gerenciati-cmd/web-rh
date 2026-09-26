# Workflows de CI/CD (pendiente)

Todavía no hay workflows activos. Esta carpeta queda reservada para ellos.

## Plan cuando se implemente

1. **`ci.yml`**: en cada PR y push a `main`:
   - `pnpm install --frozen-lockfile` y luego `pnpm check` (formato, tipos, lint, tests, arquitectura, hooks).
   - Job de migraciones con un servicio `postgres:18-alpine`: `pnpm --filter @rrhh/api db:deploy` y
     luego `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`
     para detectar cambios de esquema sin migración.
   - Node desde `.nvmrc`, pnpm desde `packageManager` y caché de `.turbo`.
2. **Build de imágenes**: `apps/api/Dockerfile` y `apps/web/Dockerfile` (construir desde la raíz).
3. **Despliegue**: correr el target `migrator` antes de actualizar el API y el worker.

Al crearlos, verificar la última versión mayor de cada action (`actions/checkout`,
`actions/setup-node`, `actions/cache`, `pnpm/action-setup`) en vez de copiarla de memoria.
