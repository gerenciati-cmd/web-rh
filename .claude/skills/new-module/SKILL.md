---
name: new-module
description: Crear un módulo de negocio nuevo en apps/api (p. ej. attendance, leave, payroll, documents) siguiendo la arquitectura hexagonal + CQRS ligero del repo, con contratos, persistencia, rutas, registro DI y tests. Usar cuando el usuario pida "crear el módulo de X" o agregar un dominio de negocio nuevo.
---

# Crear un módulo de negocio

Referencia canónica: `apps/api/src/modules/employees/` (es el más completo: agregado con reglas,
command, query, puerto hacia otro módulo). Ábrelo y replica su forma. No inventes estructura nueva.

## 0. Antes de empezar

- Confirma con el usuario el **lenguaje del dominio**: nombres de agregados, estados, reglas.
  En RRHH las reglas legales importan (p. ej. asistencia en México se rige por la Ley Federal
  del Trabajo): si hay una regla legal, pregúntala; no la inventes.
- Nombre del módulo en inglés, singular o plural según el dominio (`attendance`, `leave`, `payroll`).

## 1. Contratos (`packages/contracts/src/<modulo>/<entidad>.contract.ts`)

- Schemas Zod de lectura (DTOs) y de entrada, rutas con `defineRoute(...)`.
- Cada ruta declara `access` (`publicAccess` / `authenticated` / `requires(permission, { companyParam })`);
  permisos nuevos en `PERMISSIONS` (`packages/domain/src/identity/access.ts`) y en `ROLE_DEFINITIONS`
  (`identity/domain/role-catalog.ts`); filtrado de filas en el caso de uso con `companiesWith` (ADR 0012).
- Reusar `PageQuerySchema`, `pageOf`, `CreatedSchema`, `CountrySchema` de `common.ts` (DRY).
- Validaciones que también existen en el dominio: reusar la función del dominio (`NationalId.isValid`).
- Exportar en `packages/contracts/src/index.ts` y agregar el grupo a `apiRoutes`.

## 2. Dominio (`modules/<modulo>/domain/`)

- `<agregado>.ts`: clase que extiende `AggregateRoot`, constructor privado,
  `static create/hire/...(input): Result<...>` que valida y registra eventos, `static restore(...)`
  para rehidratar, métodos con intención de negocio (no setters).
- `<agregado>.repository.ts`: puerto de ESCRITURA (`findById`, `save`, chequeos de unicidad).
- `errors.ts`: errores concretos que extienden `NotFoundError`, `ConflictError`,
  `BusinessRuleViolationError` o `InvalidValueError`, con `code` estable en SCREAMING_SNAKE_CASE.
- Eventos: constantes `'<modulo>.<agregado>.<verbo-en-pasado>'`.
- Sin imports de fuera de `domain/` y `@rrhh/domain`. Sin IO.

## 3. Aplicación (`modules/<modulo>/application/`)

- `commands/<accion>.command.ts`: implementa `Command<Input, Output>`, `interface Deps` con SOLO
  lo que usa. Flujo: validar → cargar → invocar dominio → `save` → `eventBus.publish(pullEvents())`.
  Si escribe más de un agregado, envolver en `transactionRunner.run(...)`.
- `queries/<entidad>.queries.ts`: puerto de LECTURA que devuelve DTOs de `@rrhh/contracts`.
- `queries/<accion>.query.ts`: caso de uso de lectura delgado.
- `ports/<nombre>.ts`: lo que el módulo necesita de OTRO módulo, en sus propios términos (ACL).

## 4. Infraestructura (`modules/<modulo>/infrastructure/`)

- `<entidad>.mapper.ts`: fila Prisma ↔ dominio (`toDomain`, `toPersistence`).
- `prisma-<entidad>.repository.ts` y `prisma-<entidad>.queries.ts`. En `save`, traducir
  `isUniqueViolation` al `ConflictError` del módulo.
- `<otro-modulo>-<puerto>.ts`: adaptador que implementa un puerto usando `@/modules/<otro>` (index).
- `in-memory/`: adaptadores en memoria para tests.

## 5. Persistencia

Usa la skill `db-change`. Resumen: agregar el schema del módulo a `datasource.schemas`, modelos con
`@@schema("<modulo>")`, snake_case con `@map/@@map`, sin relaciones a otros módulos, y
`pnpm db:migrate --name create_<modulo>`.

## 6. HTTP y registro

- `http/<modulo>.router.ts`: `createXRouter(deps)` usando `bindRoute(router, routes.x, handler)`;
  commands con `unwrap(await ...)`. Cero lógica aquí.
- `<modulo>.module.ts`: `XCradle` + `xModule: AppModule<XCradle>` con todos los registros.
- `index.ts`: API pública (solo lo que otros módulos pueden usar).
- `apps/api/src/container.ts`: agregar el módulo a `modules` y su cradle a `Cradle`.
- Agregar el scope a `commitlint.config.mjs` si no existe.

## 7. Tests (obligatorios)

- `domain/<agregado>.test.ts`: cada invariante y regla.
- `application/commands/<accion>.command.test.ts`: camino feliz + cada error, con in-memory + fakes.
- Si expone rutas: casos en `apps/api/tests/http.test.ts` o un archivo nuevo de tests HTTP, y
  registrar los adaptadores en memoria en `tests/test-app.ts`.

## 8. Cierre

Corre `pnpm check` (y `pnpm test:integration` si tocaste `infrastructure/`) y cumple la
definición de terminado de `AGENTS.md`. Si la web o mobile deben usar el módulo, el cliente ya lo expone en
`api.<grupo>.<ruta>(...)`: no escribas fetch a mano.
