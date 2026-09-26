# 0006 — Persistencia: Postgres + Prisma 7 detrás de puertos

- **Estado**: Aceptado
- **Fecha**: 2026-09-25

## Contexto

Sla aplicación no debe saber que base de datos utiliza, por si se necesita cambiar, agregar o modificar alguna base de datos por alguna razón.

## Decisión

- PostgreSQL 18 + Prisma 7 (`prisma-client` generator, `@prisma/adapter-pg`, `prisma.config.ts`).
- Prisma solo en `infrastructure/` (regla `prisma-only-in-infrastructure`). Repositorios y
  queries son interfaces; mappers traducen filas ↔ dominio/DTO.
- Un schema de Postgres por módulo; sin relaciones entre módulos; tablas en snake_case.
- IDs UUID v7 generados en la app (`IdGenerator`): ordenables por tiempo, sin ida y vuelta a la BD.
- Transacciones vía `TransactionRunner` + AsyncLocalStorage.
- Migraciones versionadas; nunca se editan las aplicadas; `db push`/`migrate reset` bloqueados.

## Alternativas consideradas

- **Drizzle**: más cercano a SQL y liviano; Prisma se eligió por madurez de migraciones y DX del equipo.
  Gracias a los puertos, cambiar de ORM afecta solo a `infrastructure/`.
- **TypeORM**: patrones Active Record/decoradores que filtran la persistencia al dominio.

## Consecuencias

- Cambiar de ORM o de motor = reescribir adaptadores, no dominio ni casos de uso.
- El mapeo explícito agrega código, a cambio de que ningún tipo de Prisma llegue al dominio.
