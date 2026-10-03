---
name: new-use-case
description: Agregar un caso de uso (command de escritura o query de lectura) a un módulo existente del API, de punta a punta — contrato, caso de uso, adaptadores, ruta, registro DI y tests. Usar cuando se pida un endpoint o una operación nueva en un módulo que ya existe.
---

# Agregar un caso de uso

Primero decide: **¿cambia estado?**

- Sí → **Command**. Pasa por el agregado; las reglas de negocio viven en el dominio.
- No → **Query**. Lee vía el puerto `XxxQueries`; no construye agregados.

## Command (ejemplo: `employees/application/commands/register-employee.command.ts`)

1. **Contrato**: schema Zod de entrada + `defineRoute` en `packages/contracts/src/<modulo>/`.
   Respuesta típica: `CreatedSchema` (201) o sin cuerpo (204). La ruta lleva `description`
   (obligatoria: qué hace, quién puede, qué necesita, efectos) y `errors` con los códigos de
   dominio que devuelve el caso de uso (404/409/422/429; 400/401/403 se derivan solos). Cada campo
   de entrada con `.describe()`; los opcionales empiezan con "Opcional." y dicen qué pasa si se
   omiten. Un código nuevo va a `API_ERRORS` (`packages/contracts/src/errors.ts`) con status,
   descripción y ejemplo real; `apps/api/tests/error-catalog.test.ts` falla si falta o difiere.
2. **Dominio**: si la operación introduce una regla, va como método del agregado que devuelve
   `Result` y registra un evento. Test de la regla en `domain/*.test.ts`.
3. **Caso de uso** `<accion>.command.ts`:
   ```ts
   interface Deps {
     xRepository: XRepository;
     clock: Clock;
     eventBus: EventBus;
   } // solo lo que usa
   export class DoThing implements Command<DoThingInput, Output> {
     constructor(private readonly deps: Deps) {}
     async execute(input: DoThingInput) {
       const x = await this.deps.xRepository.findById(input.id);
       if (!x) return err(new XNotFoundError(input.id));
       const result = x.doThing(this.deps.clock.now());
       if (!result.ok) return result;
       await this.deps.xRepository.save(x);
       await this.deps.eventBus.publish(x.pullEvents());
       return ok(undefined);
     }
   }
   ```
4. Si el repositorio necesita un método nuevo: agrégalo al PUERTO, al adaptador Prisma y al
   adaptador en memoria (los tres; si no, `tsc` fallará, y eso es bueno).
5. **Ruta** en `http/<modulo>.router.ts`: `bindRoute(router, routes.doThing, async ({ params, body }) => unwrap(await deps.doThing.execute({...})))`.
6. **Registro** en `<modulo>.module.ts` (`registrations` y `XCradle`).
7. **Tests**: `<accion>.command.test.ts` con in-memory + `FixedClock`/`RecordingEventBus`:
   camino feliz, cada error, y que se publicó el evento.

## Query (ejemplo: `organization/application/queries/list-companies.query.ts`)

1. **Contrato**: DTO de respuesta + `defineRoute` (con `query: PageQuerySchema.extend({...})` si filtra),
   con `description`, `errors` si el caso de uso devuelve alguno, y `.describe()` en cada filtro
   ("Opcional. … si se omite, …").
2. **Puerto**: agrega el método a `XxxQueries` devolviendo el DTO del contrato.
3. **Adaptador Prisma** `prisma-<entidad>.queries.ts`: `select` SOLO de las columnas necesarias,
   paginación con `skip/take` + `count` en `Promise.all`. Fechas → ISO string.
4. **Caso de uso** `<accion>.query.ts` delgado (sin chequeos de permiso aquí: el acceso se declara en el contrato con
   `access`: `publicAccess` / `authenticated` / `requires(permission, { companyParam })`; permisos nuevos
   van en `PERMISSIONS` de `packages/domain/src/identity/access.ts` y en `ROLE_DEFINITIONS` de
   `identity/domain/role-catalog.ts`; el filtrado de filas va en el caso de uso con
   `companiesWith(actor, permission)`, ADR 0012).
5. Ruta, registro y test HTTP igual que en el command.

## No hagas

- Lógica de negocio en el router, en el mapper o en el adaptador de queries.
- Devolver tipos de Prisma o agregados por HTTP.
- Leer tablas de otro módulo en una query: usa su API pública o pide un read model (ADR).

Cierra con `pnpm check` (+ `pnpm test:integration` si tocaste adaptadores Prisma).
