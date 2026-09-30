# Arquitectura

## Vista general

```
             ┌──────────────┐        ┌──────────────┐
             │  apps/web    │        │ apps/mobile  │   Solo UI. Sin reglas de negocio.
             │  Next.js 16  │        │  Expo 57     │
             └──────┬───────┘        └──────┬───────┘
                    │  @rrhh/api-client (tipado desde @rrhh/contracts)
                    └───────────┬───────────┘
                                ▼  HTTP /api/v1   ◀── reloj ZKTeco: HTTP /iclock/* (ADR 0008)
┌───────────────────────────────────────────────────────────────────────┐
│ apps/api  (un proceso HTTP + un proceso worker, MISMA imagen/código)  │
│                                                                       │
│  ┌────────────── modules/ (monolito modular) ───────────────────┐     │
│  │ organization │ employees │ attendance† │ leave* │ payroll* … │     │
│  └──────────────────────────────────────────────────────────────┘     │
│  shared/application (puertos) · infrastructure (adaptadores comunes)  │
└──────────────┬─────────────────────┬──────────────────────┬───────────┘
               ▼                     ▼                      ▼
        PostgreSQL 18          Valkey (BullMQ)        S3 (RustFS en dev)
   un schema por módulo       jobs asíncronos          documentos
                                                        * = por construir
                                               † = solo sonda ZKTeco (log)
```

## Monolito modular

Un solo deployable, con **fronteras internas estrictas** entre módulos (ver
[ADR 0002](adr/0002-monolito-modular.md)). Cada módulo:

- Es dueño de su **schema de Postgres** y de sus tablas. Nadie más las lee ni escribe.
- Expone una **API pública** en `index.ts` (fachada + tipos + eventos). Lo demás es privado.
- Se comunica con otros módulos de dos formas:
  - **Síncrona**: un puerto propio (`EmployerDirectory`) implementado por un adaptador que llama
    a la fachada del otro módulo (`OrganizationApi`). Esto es un anti-corruption layer.
  - **Asíncrona**: eventos de dominio (`employees.employee.hired`) vía `EventBus`.

Si un módulo necesita escalar por separado (p. ej. asistencia con miles de marcaciones/minuto),
se extrae a un servicio: solo cambian sus adaptadores, no su dominio ni el de los demás.

## Capas dentro de un módulo (hexagonal)

```
modules/employees/
├── domain/            Agregados, value objects, reglas, eventos, puertos de ESCRITURA.
│                      Puro: sin IO, sin frameworks. Solo depende de @rrhh/domain.
├── application/       Casos de uso. Orquesta el dominio a través de puertos.
│   ├── commands/      Escrituras → devuelven Result
│   ├── queries/       Lecturas → puerto XxxQueries + caso de uso delgado
│   └── ports/         Lo que este módulo necesita del exterior, en SUS términos
├── infrastructure/    Adaptadores: Prisma, otros módulos, in-memory (tests), mappers
├── http/              Router Express: traduce HTTP ↔ caso de uso. Cero lógica.
├── employees.module.ts  Registro DI (AppModule)
└── index.ts           API pública del módulo
```

Regla de dependencia: `http → application → domain ← infrastructure`. Las flechas apuntan hacia
el dominio. Se verifica con `pnpm arch:check` (`apps/api/.dependency-cruiser.cjs`).

## CQRS ligero

Ver [ADR 0003](adr/0003-hexagonal-cqrs-ligero.md).

|                   | Command (escritura)                   | Query (lectura)                         |
| ----------------- | ------------------------------------- | --------------------------------------- |
| Pasa por          | Agregado de dominio + `XxxRepository` | Puerto `XxxQueries`                     |
| Reglas de negocio | Sí, en el agregado                    | No hay nada que proteger                |
| Devuelve          | `Result<id \| void, DomainError>`     | DTO de `@rrhh/contracts`                |
| Optimización      | Consistencia                          | `select` justo, joins, vistas, réplicas |

Misma base de datos para ambos lados. Si un reporte lo requiere, el adaptador de queries puede
leer de una vista materializada o réplica sin tocar el dominio.

## Flujo de un request (command)

Antes de llegar al router de cualquier módulo, `cookieParser()` y luego `createAuthenticate(...)`
(`src/http/authenticate.ts`) resuelven el actor desde `Authorization: Bearer` o la cookie de
sesión y lo dejan en `res.locals.actor` (`null` si no hay token o no es válido). `bindRoute` arma
con eso un `RequestContext` (`actor`, `client.ip/userAgent`, `cookies`) y lo pasa como segundo
argumento al handler; `requireActor(context)` lo exige donde el endpoint no admite anónimos (ver
ADR 0011).

Cada ruta declara su acceso en el contrato (`access`: pública, autenticada o con un permiso, con
`companyParam` si el permiso se comprueba contra una empresa del path). `bindRoute` lo hace cumplir
antes del handler contra los `grants` del actor (expandidos por petición desde sus asignaciones de
rol): 401 sin sesión, 403 sin permiso (ADR 0012).

```
POST /api/v1/companies/:id/employees
 → bindRoute: valida params con el schema de @rrhh/contracts (400 si falla)
 → bindRoute: autoriza según route.access (401 sin sesión · 403 sin permiso/alcance)
 → bindRoute: valida query/body (400 si falla; un anónimo nunca llega aquí)
 → RegisterEmployee.execute(input)
     → EmployerDirectory.find()  ──(adaptador)──▶ OrganizationApi.findCompany()
     → NationalId.create / Email.create        (value objects, Result)
     → EmployeeRepository.existsInCompany()
     → Employee.hire(...)                       (reglas + evento EmployeeHired)
     → EmployeeRepository.save()                (Prisma, dentro de la tx activa si la hay)
     → EventBus.publish(employee.pullEvents())
 → unwrap(Result): ok → 201 { id } · err → errorHandler mapea categoría → 404/409/422
```

## Errores

- **Esperados** (validación, reglas, no encontrado, conflicto) → `Result` con un `DomainError`
  con `code` estable. La capa HTTP traduce la **categoría** a status:
  `NotFoundError→404`, `ConflictError→409`, `InvalidValueError/BusinessRuleViolationError→422`,
  `AuthenticationError→401`, `TooManyRequestsError→429`.
- **Entrada HTTP inválida** → 400 `VALIDATION_ERROR` con los issues de Zod por campo.
- **Sin sesión válida** (o token desconocido/vencido) → 401 `AUTHENTICATION_REQUIRED`: error de
  adaptador (`src/http/request-context.ts`), igual que `RequestValidationError`, no una categoría
  de dominio.
- **Sin permiso o fuera de alcance** → 403 `FORBIDDEN`: también error de adaptador (`PermissionDeniedError`).
- **Inesperados** → se loguean completos y el cliente recibe 500 `INTERNAL_ERROR` sin detalles.
- Los clientes reciben siempre `{ code, message, details? }` (`ApiErrorSchema`) y usan `code` para i18n.

## Persistencia

Ver [ADR 0006](adr/0006-persistencia.md). Prisma 7 con `@prisma/adapter-pg`, cliente generado en
`src/infrastructure/database/generated` (no versionado). `PrismaDatabase.client` devuelve la
transacción activa (AsyncLocalStorage) o el cliente raíz, así los repositorios participan en
`TransactionRunner.run(...)` sin recibir `tx` por parámetro.

## Eventos y jobs

- `InMemoryEventBus`: in-process, tras el commit. Suficiente para efectos secundarios no críticos.
  Para eventos que no pueden perderse, migrar a Transactional Outbox ([ADR 0005](adr/0005-eventos.md)).
- `JobQueue` (BullMQ sobre Valkey): trabajo pesado o diferido (cálculo de nómina, reportes,
  cierres de asistencia). Los módulos declaran `jobs` en su `AppModule`; `src/main/worker.ts` los ejecuta.
- **Jobs sensibles**: si el payload lleva un secreto (p. ej. el token de un enlace de activación),
  se encola con `{ sensitive: true }`: BullMQ lo elimina de Valkey al terminar, con éxito o con fallo.
  El correo sale siempre por un job (`EmailSender` en el worker), nunca dentro de la petición HTTP.
- **Primera suscripción entre módulos**: `identity` escucha `employees.employee.terminated`
  (`AppModule.subscribe`) y deshabilita el acceso del colaborador y cierra sus sesiones. Un evento
  perdido (ADR 0005) deja el acceso activo hasta la siguiente baja; el outbox lo resolverá.

## Composición y DI

`src/container.ts` es el **composition root**: el único lugar que conoce las clases concretas.
awilix en modo PROXY: cada clase recibe un objeto `deps` tipado con solo lo que usa.
`tests/container.test.ts` resuelve todos los registros para detectar errores de nombres.

## Clientes (web y mobile)

- Consumen el API exclusivamente con `@rrhh/api-client`, que se genera en runtime a partir de
  `apiRoutes`: `api.organization.listCompanies({ query })` está tipado de punta a punta y valida
  la respuesta contra el contrato.
- Web: Server Components llaman al API desde el servidor (`src/lib/api.ts`). Rutas delgadas,
  UI en `src/features/<modulo>/`.
- Mobile: hooks de datos en `src/features/<modulo>/hooks/`, pantallas en `src/app/` (expo-router).

## Pendiente (siguiente etapa)

- Módulo `identity`: alcances de equipo (Jefe directo) y propio (Colaborador) del RBAC; los de
  holding y empresa ya se aplican (ADR 0012). Usuarios, login/logout, sesiones opacas y
  throttling ya existen (ADR 0011).
- Multi-tenancy: filtro por empresa en repositorios/queries + RLS en Postgres como segunda barrera.
- Auditoría (quién cambió qué) como módulo transversal alimentado por eventos.
- Outbox para eventos críticos. Observabilidad (OpenTelemetry).

## Vocabulario y escrituras esperadas

El [ADR 0007](adr/0007-vocabulario-compartido-y-errores-esperados.md) permite compartir vocabulario
puro con dueño explícito entre dominio y contratos. EmployeeStatus se deriva de EMPLOYEE_STATUSES;
Prisma mantiene su representación de almacenamiento sin filtrarla a otras capas.
Los puertos de escritura retornan Result ante conflictos esperados; las fallas inesperadas rechazan
la promesa. El command revisa el resultado antes de publicar eventos. El bus no programa callbacks
post-commit: publicar después de persistir es responsabilidad del caller; no hay outbox todavía.
