# RRHH · APS Holding

Plataforma de gestión de personas para las empresas del holding (reemplazo de Buk): colaboradores,
asistencia, vacaciones y licencias, remuneraciones y documentos. Web, app móvil y API en un monorepo.

| App / paquete         | Stack                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| `apps/api`            | Node 24+ · Express 5 · TypeScript · Prisma 7 · PostgreSQL 18 · BullMQ    |
| `apps/web`            | Next.js 16 (App Router) · React 19 · Tailwind 4                          |
| `apps/mobile`         | Expo SDK 57 · React Native 0.86 · expo-router                            |
| `packages/contracts`  | Contratos HTTP con Zod 4 (fuente única de verdad)                        |
| `packages/api-client` | Cliente tipado derivado de los contratos                                 |
| `packages/domain`     | Shared kernel (Result, CountryCode, TaxId/NationalId, Money, DateRange…) |

## Empezar

Requisitos: **Node ≥ 24**, **pnpm ≥ 12** y **Docker**.

```bash
pnpm bootstrap   # .env, dependencias, infraestructura, migraciones y datos de ejemplo
pnpm dev:api     # http://localhost:3001/api/v1  (health: /health/ready)
pnpm dev:web     # http://localhost:3000
pnpm dev:mobile  # Expo: escanea el QR con Expo Go
```

Servicios locales (`pnpm db:up` / `pnpm db:down`): Postgres `:5432`, Valkey `:6379`,
S3 (RustFS) `:9000`, consola en [localhost:9001/rustfs/console/](http://localhost:9001/rustfs/console/)
y Mailpit en `:8025`.

## Comandos habituales

```bash
pnpm check                            # formato, tipos, lint, tests, arquitectura, hooks
pnpm --filter @rrhh/api test          # tests de un paquete
pnpm db:migrate --name add_positions  # nueva migración tras editar schema.prisma
pnpm db:studio                        # explorar la BD
pnpm db:reset                         # reconstruye la BD de desarrollo (pide confirmación; --no-seed la deja vacía)
pnpm db:reset --test                  # reconstruye rrhh_test
pnpm --filter @rrhh/contracts openapi # regenera openapi.json tras cambiar un contrato
docker build -f apps/api/Dockerfile .  # imagen del API (web: apps/web/Dockerfile)
```

Referencia interactiva del API (solo fuera de producción): `http://localhost:3001/api/v1/docs`.

## Arquitectura en una frase

**Monolito modular** con **arquitectura hexagonal** y **CQRS ligero** en el API, contratos Zod
compartidos con web y mobile, y reglas de arquitectura verificadas localmente y en CI.
Detalle en [docs/architecture.md](docs/architecture.md), principios (SOLID, DRY…) con ejemplos
del código en [docs/conventions.md](docs/conventions.md), y decisiones en [docs/adr/](docs/adr/).

## Trabajar con agentes de IA

El repo trae un **harness** para Claude Code y Codex (y cualquier agente que lea `AGENTS.md`):

- **Pipeline guiado por planes** ([docs/harness/](docs/harness/HARNESS.md)): plan → implementar →
  tests → review → verify. El estado vive en el frontmatter del plan (`plans/`) y la evidencia de
  cada fase se escribe en el mismo plan. `pnpm plans:status` dice qué sigue.
- **Roles** (`docs/harness/roles/`) → adaptadores **generados**: subagentes y skills de Claude
  (`.claude/`) y perfiles de Codex (`.codex/`, `.agents/`). `pnpm harness:sync` los regenera y
  `pnpm check` falla si se desfasan.
- **Guardas mecánicas**: hooks que bloquean acciones destructivas (git stash/restore, borrar
  untracked, force push, reset de BD, borrar volúmenes…), `plans:lint`, `plans:scope` y
  `arch:check`. Todo con tests (`pnpm test:harness`).
- [AGENTS.md](AGENTS.md) es la entrada (estándar abierto); [CLAUDE.md](CLAUDE.md) lo importa.

## Convenciones de git

Ramas `feat/<modulo>-<tema>` · Conventional Commits en español (validados por commitlint) ·
PR con la plantilla de `.github/`. `pre-commit` formatea lo staged y `commit-msg` valida el mensaje.

## Desarrollo local seguro y reproducible

Los puertos de PostgreSQL, Valkey, RustFS y Mailpit se publican solo en `127.0.0.1`.
Las apps siguen ejecutándose en el host. El API mantiene su acceso por LAN para probar Expo
con un dispositivo físico; este cambio no agrega autenticación ni habilita uso con datos reales.

Bootstrap usa `POSTGRES_USER` y `POSTGRES_DB` del contenedor al preparar `rrhh_test`. Si
personalizas esas variables o `POSTGRES_PORT`, configura también las conexiones de la app:
`DATABASE_URL` para desarrollo y `DATABASE_URL_TEST` apuntando explícitamente a `rrhh_test`.
Cambiar variables de Compose no cambia roles ni contraseñas de un volumen ya inicializado.
Bootstrap no sobrescribe archivos de entorno existentes ni elimina datos.

Las cuatro imágenes de infraestructura están fijadas por digest. Para actualizarlas, consulta
el manifiesto del repositorio oficial con `docker buildx imagetools inspect <referencia>`,
verifica plataformas y compatibilidad con los datos existentes, reemplaza el digest y prueba
el servicio. Actualiza también PostgreSQL en CI. No borres volúmenes para resolver incompatibilidades.

Al recibir SIGTERM/SIGINT, el API deja de aceptar conexiones y espera las peticiones activas
antes de cerrar la BD y las colas. El cierre completo tiene un máximo de 8 segundos; un error o
plazo agotado termina con código 1, y un cierre normal con código 0.

## Verificación local y CI

`pnpm check` ejecuta formato, tipos, lint, tests (incluido bootstrap), arquitectura y harness.
`pnpm test:integration` comprueba persistencia contra PostgreSQL local y exige una base `_test`.
No necesitas esperar a CI para ejecutar estos mismos controles durante desarrollo.

GitHub Actions ejecuta calidad con Node de `.nvmrc` y Node 24, integración y migraciones con
PostgreSQL efímero, y builds Docker de web, API y migrador. No publica imágenes ni despliega.
Consulta [el detalle de los checks](.github/workflows/README.md).

## Contribución

Consulta [CONTRIBUTING.md](CONTRIBUTING.md) para convenciones, pruebas, seguridad y flujo de PR.
