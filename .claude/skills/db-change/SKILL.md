---
name: db-change
description: Modificar el esquema de base de datos (Prisma 7 + Postgres) de forma segura — agregar tablas, columnas, índices o un schema de módulo nuevo, y generar la migración. Usar siempre que se toque apps/api/prisma/schema.prisma.
---

# Cambiar el esquema de base de datos

## Reglas

- **Nunca** editar una migración existente en `apps/api/prisma/migrations/` (bloqueado por hook):
  pudo aplicarse en otro entorno. Siempre una migración nueva.
- **Nunca** `prisma db push` ni `prisma migrate reset` (bloqueados). Si la BD local quedó
  inconsistente, díselo al usuario y que él decida resetear.
- Un **schema de Postgres por módulo** (`@@schema("attendance")`), agregado a
  `datasource.schemas`. Sin relaciones/FK entre módulos: referencia por id (`companyId String @db.Uuid`).
- Nombres: modelo `PascalCase`, campos `camelCase`, tabla/columna `snake_case` vía `@@map`/`@map`.
- Tipos explícitos: `@db.Uuid` para ids, `@db.Timestamptz(3)` para instantes, `@db.Date` para
  fechas de calendario, `@db.VarChar(n)` con largo razonable. Dinero: `BigInt`/`Int` en unidad
  mínima + columna de moneda, nunca `Float`/`Decimal` para montos de nómina.
- Índices para cada filtro frecuente de las queries (`@@index([companyId, status])`) y
  `@@unique` para cada invariante de unicidad (última defensa ante carreras).
- Columnas nuevas en tablas con datos: opcionales o con `@default`, o migración en dos pasos
  (agregar nullable → backfill → hacer requerida).
- Borrar/renombrar columnas: explícale al usuario el impacto antes (Prisma lo hace como DROP+ADD
  y se pierden datos) y propón expand/contract.

## Pasos

1. Editar `apps/api/prisma/schema.prisma`.
2. `pnpm --filter @rrhh/api exec prisma format` y `pnpm --filter @rrhh/api exec prisma validate`.
3. Con la infra arriba (`pnpm db:up`): `pnpm db:migrate --name <cambio_en_snake_case>`.
4. **Revisar el SQL generado** en la nueva carpeta de `migrations/`: si hay `DROP`, avisar al usuario.
5. Actualizar mapper(s) y adaptadores Prisma del módulo; `pnpm typecheck` marcará lo que falte.
6. `pnpm check` y `pnpm test:integration` (aplica las migraciones a la base de test).
