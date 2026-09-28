# Convenciones y principios

Cada principio apunta a un ejemplo REAL del repo. Cuando dudes, imita el ejemplo.

## SOLID aplicado

### S — Responsabilidad única

Cada clase tiene una razón para cambiar.

- `CreateCompany` (caso de uso) orquesta; `Company` (agregado) protege invariantes;
  `PrismaCompanyRepository` persiste; `CompanyMapper` traduce; `createOrganizationRouter` traduce HTTP.
- CQRS ligero separa escribir (`CompanyRepository`) de leer (`CompanyQueries`): cambian por
  motivos distintos (reglas de negocio vs. necesidades de pantalla).

### O — Abierto/Cerrado

Extender sin modificar lo existente.

- `packages/domain/src/national-id/validators.ts`: un país nuevo = un validador nuevo en el mapa;
  `NationalId` no se toca.
- `apps/api/src/http/error-handler.ts`: `STATUS_BY_CATEGORY` es una tabla; una categoría nueva
  es una fila.
- `apps/api/src/container.ts`: un módulo nuevo se agrega a `modules`; `createApp` y el worker lo
  recorren sin cambios.

### L — Sustitución de Liskov

Cualquier implementación de un puerto es intercambiable.

- `InMemoryCompanyRepository` y `PrismaCompanyRepository` cumplen el mismo `CompanyRepository`;
  los tests de `CreateCompany` usan uno y producción el otro, sin cambiar el caso de uso.
- Un adaptador **no** debe lanzar errores que el puerto no contempla ni ignorar parámetros.

### I — Segregación de interfaces

Depender solo de lo que se usa.

- Cada caso de uso declara su `interface Deps` con lo mínimo (`CreateCompany` no ve `jobQueue`).
- `EmployerDirectory` expone solo `find()` con 3 campos, no toda la empresa.

### D — Inversión de dependencias

Lo de alto nivel depende de abstracciones; los detalles se inyectan.

- Casos de uso dependen de `Clock`, `IdGenerator`, `EventBus`, `XRepository` (interfaces en
  `shared/application/ports.ts` y `domain/`), nunca de Prisma o BullMQ.
- `@rrhh/api-client` recibe `getAccessToken` y `fetch` inyectados: web y mobile deciden de dónde
  sale el token.

## DRY (sin exagerar)

- **Contratos**: un endpoint se define una vez en `@rrhh/contracts`; API (validación), web y mobile
  (tipos + cliente) lo derivan. Nunca redeclarar tipos de request/response. Excepción: rutas
  de equipos físicos con protocolo propio (`deviceRouter`,
  [ADR 0008](adr/0008-endpoints-de-dispositivos-fuera-de-contratos.md)).
- **Validación compartida**: `CreateCompanySchema` usa `NationalId.isValid` del dominio: el
  formulario y el backend fallan con la misma regla.
- **`bindRoute`**: validación de entrada, status y verificación de respuesta en un solo lugar.
- **`pageOf(schema)` / `PageQuerySchema`**: toda paginación tiene la misma forma.
- **pnpm `catalog:`**: una versión por dependencia compartida en todo el monorepo.
- **Configs compartidas**: `@rrhh/tsconfig`, `@rrhh/eslint-config`.

DRY es sobre **conocimiento**, no sobre texto parecido. Dos módulos con código similar pero reglas
de negocio distintas **no** se unifican: se acoplarían cosas que cambian por separado. Espera a la
tercera repetición real antes de abstraer.

## Otros principios

- **Fail fast**: `loadEnv()` valida el entorno al arrancar; los value objects validan al crearse.
- **Make illegal states unrepresentable**: ids con marca de tipo (`CompanyId` ≠ `EmployeeId`),
  constructores privados + fábricas que devuelven `Result`, `readonly` por defecto.
- **Tell, don't ask**: `employee.terminate(date)` en vez de `employee.status = 'TERMINATED'`.
- **Composition over inheritance**: la herencia se usa solo para `Entity/AggregateRoot` y
  categorías de error; el resto se compone vía DI.
- **YAGNI**: no crear capas, genéricos ni configuraciones "por si acaso".

## Nombres

| Elemento                    | Convención                                                       | Ejemplo                                  |
| --------------------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| Archivos                    | kebab-case + sufijo de rol                                       | `register-employee.command.ts`           |
| Clases / tipos / interfaces | PascalCase                                                       | `RegisterEmployee`, `EmployeeRepository` |
| Casos de uso                | Verbo + sustantivo, sin sufijo "UseCase"                         | `CreateCompany`, `ListEmployees`         |
| Adaptadores                 | Tecnología + puerto                                              | `PrismaEmployeeQueries`                  |
| Códigos de error            | SCREAMING_SNAKE_CASE, estables                                   | `EMPLOYEE_ALREADY_EXISTS`                |
| Eventos                     | `<modulo>.<agregado>.<pasado>`                                   | `employees.employee.hired`               |
| Tablas / columnas           | snake_case (vía `@@map`/`@map`)                                  | `employees.employees.hire_date`          |
| Rutas HTTP                  | plural, recursos anidados por empresa                            | `/companies/:companyId/employees`        |
| Idioma                      | Código en inglés; comentarios, mensajes, UI y commits en español |                                          |

## TypeScript

- `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` (ver `packages/tsconfig/base.json`).
- Prohibido `any`; usa `unknown` y estrecha. Evita `as` salvo en fronteras (ids de marca, mappers).
- `import type` para tipos. Sin `default export` salvo donde el framework lo exige.
- Preferir `interface` para formas de objetos y `type` para uniones.

## Tests

- Nombres de test en español describiendo comportamiento: `'rechaza duplicados aunque el RUT venga con otro formato'`.
- Arrange-Act-Assert, un comportamiento por test, sin lógica condicional en los tests.
- Deterministas: `FixedClock`, `SequentialIdGenerator`, nada de `Date.now()`/red/BD en unit tests.

## Constantes y conjuntos de valores

| Elemento                                       | Regla                                    | Ejemplo                                              |
| ---------------------------------------------- | ---------------------------------------- | ---------------------------------------------------- |
| Archivos y carpetas                            | kebab-case; sufijo de rol cuando aplique | `employee-status.ts`, `employee-policy.constants.ts` |
| Constantes fijas, catálogos, nombres de evento | SCREAMING_SNAKE_CASE                     | `EMPLOYEE_STATUSES`, `EMPLOYEE_HIRED`                |
| Variables y funciones                          | camelCase, aunque se declaren con const  | `employee`, `registerEmployee`                       |
| Clases, interfaces y tipos                     | PascalCase                               | `EmployeeStatus`                                     |
| Schemas Zod                                    | PascalCase + Schema                      | `EmployeeStatusSchema`                               |
| Tablas y columnas                              | snake_case con mapeo Prisma              | `hire_date`                                          |

Una constante privada permanece junto a su uso. Si varios consumidores comparten su significado,
se extrae a un archivo específico del módulo propietario. No hay una carpeta global de constantes.
Un literal merece nombre si expresa política, unidad o conocimiento compartido; no se extraen
ceros, índices o textos obvios solo para reducir literales.

Para tipos sin uso en ejecución, usa uniones literales. Para valores usados en ejecución, una lista
u objeto `as const` es la fuente y el tipo se deriva: `type Status = (typeof STATUSES)[number]`.
No uses enums numéricos ni `enum` de TypeScript como patrón habitual. Los enums de Prisma pertenecen
a persistencia; no se importan en dominio/UI. `as const` no congela objetos en ejecución.

El vocabulario compartido entre capas es puro y tiene dueño explícito; ver
[ADR 0007](adr/0007-vocabulario-compartido-y-errores-esperados.md). El dominio nunca importa Zod o
contratos HTTP para reutilizar valores. Conceptos con significados diferentes se traducen en la
frontera en vez de unificarse artificialmente.

Excepciones: nombres reservados de frameworks (`_layout.tsx`, `page.tsx`, configuraciones), variantes
`.web.tsx`, default exports exigidos por rutas/configs, schemas Zod y objetos mapper existentes
(`EmployeeMapper`, servicio sin estado). Componentes reutilizables usan exports nombrados.
`styles`, instancias, servicios DI, funciones y `metadata` no se vuelven mayúsculas por ser const.

## Documentación del código

Los docblocks son selectivos, en español. Documenta interfaces públicas y comportamiento no
obvio: invariantes, unidades, límites inclusivos/exclusivos, significado de null, efectos secundarios,
errores esperados como Result, excepciones inesperadas y garantías de mutabilidad/durabilidad.
Usa `@param`, `@returns`, `@throws` o ejemplos solo si agregan información que no expresan los tipos.
No exijas comentarios en cada exportación/getter ni repitas la firma TypeScript en prosa.

Los comentarios explican decisiones y restricciones, y se actualizan junto al comportamiento.
Ningún docblock puede prometer una transacción, inmutabilidad o aislamiento que su implementación
no garantiza. La review verifica exactitud; no se mide calidad contando comentarios con regex.
