# RRHH · APS Holding

Plataforma de gestión de personas para las empresas del holding (reemplazo de Buk): colaboradores,
asistencia, vacaciones y licencias, remuneraciones y documentos. Web, app móvil y API en un monorepo.

| App / paquete         | Stack                                                                 |
| --------------------- | --------------------------------------------------------------------- |
| `apps/api`            | Node 24+ · Express 5 · TypeScript · Prisma 7 · PostgreSQL 18 · BullMQ |
| `apps/web`            | Next.js 16 (App Router) · React 19 · Tailwind 4                       |
| `apps/mobile`         | Expo SDK 57 · React Native 0.86 · expo-router                         |
| `packages/contracts`  | Contratos HTTP con Zod 4 (fuente única de verdad)                     |
| `packages/api-client` | Cliente tipado derivado de los contratos                              |
| `packages/domain`     | Shared kernel (Result, NationalId/RUT, Money, DateRange…)             |

## Empezar

Requisitos: **Node ≥ 24**, **pnpm ≥ 12** y **Docker**.

```bash
pnpm bootstrap   # .env, dependencias, infraestructura, migraciones y datos de ejemplo
pnpm dev:api     # http://localhost:3001/api/v1  (health: /health/ready)
pnpm dev:web     # http://localhost:3000
pnpm dev:mobile  # Expo: escanea el QR con Expo Go
```

Servicios locales (`pnpm db:up` / `pnpm db:down`): Postgres `:5432`, Valkey `:6379`,
S3 (RustFS) `:9000` con consola en `:9001`, Mailpit en `:8025`.

## Comandos habituales

```bash
pnpm check                            # TODO: formato, tipos, lint, tests, arquitectura, hooks
pnpm --filter @rrhh/api test          # tests de un paquete
pnpm db:migrate --name add_positions  # nueva migración tras editar schema.prisma
pnpm db:studio                        # explorar la BD
docker build -f apps/api/Dockerfile .  # imagen del API (web: apps/web/Dockerfile)
```

## Arquitectura en una frase

**Monolito modular** con **arquitectura hexagonal** y **CQRS ligero** en el API, contratos Zod
compartidos con web y mobile, y reglas de arquitectura verificadas en CI.
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
