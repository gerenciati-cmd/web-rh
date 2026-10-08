---
status: done
module: attendance
min_implementer: mid
depends_on: []
---

# 005 — Targeted writes of the device row

## Context

Fixes the finding `plans/hallazgos/attendance-escritura-completa-del-equipo.md` (review Low-1 of
plan 003), with the approach the user chose on 2026-10-06 (README decision 11).

**What exists today:**

- `PrismaDeviceRepository.save` upserts the **whole** row from the aggregate
  (`apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts:27-42`, data from
  `DeviceMapper.toPersistence`, `infrastructure/attendance.mapper.ts:33-46`).
- Two kinds of writers share that row:
  - Device traffic: `RecordDevicePush` loads the device by serial, measures the clock offset and
    marks it seen, then saves it whole (`application/commands/record-device-push.command.ts:52`,
    `:112-113`); `RecordDeviceContact` does the same for `lastSeenAt`
    (`application/commands/record-device-contact.command.ts:47`, `:54`).
  - Admin: `AssignDeviceSite` loads the device, `assignSite(siteId, timeZone)` and saves it whole
    (`application/commands/assign-device-site.command.ts:27-36`; aggregate
    `domain/device.ts:142-145`).
- Race: a push that loaded the device before a `PUT …/site` and saves after it writes back the old
  `siteId` and `timeZone`; later punches are converted with the old zone. Not reproduced; the
  window is short but falls on installation day.
- `RegisterDevice` is the only creator (`application/commands/register-device.command.ts:53`) and
  needs the upsert's unique-violation mapping to `DeviceAlreadyRegisteredError`
  (`prisma-device.repository.ts:36-40`).
- In-memory repository: `save` stores the object reference
  (`infrastructure/in-memory/in-memory-attendance.store.ts:60-68`).

**Approach.** Each use case that changes an existing device writes only the columns it owns:
two new repository methods, `saveActivity` (`lastSeenAt`, `clockOffsetSeconds`,
`clockOffsetMeasuredAt`) and `saveSite` (`siteId`, `timeZone`), each a Prisma `update` by id.
`save` stays for registration. Alternative considered: an optimistic `version` column — more
general, but needs a migration and a retry/conflict path for the device, which cannot be told to
retry. Rejected by the user (decision 11).

## Out of scope

- The punches of a push in flight during a site change are converted with the zone loaded at the
  start of that push; that is correct for punches that happened before the change and is not
  touched.
- `active` and `name` have no writer besides registration today; no method for them.
- Optimistic versioning, any migration, any contract change.

## Dependencies

None

## Steps

1. **Repository port**
   - Files: `apps/api/src/modules/attendance/domain/device.repository.ts` (modify)
   - Do: add `saveActivity(device: Device): Promise<void>` (docblock: writes only `lastSeenAt`,
     `clockOffsetSeconds`, `clockOffsetMeasuredAt`; used by device traffic) and
     `saveSite(device: Device): Promise<void>` (docblock: writes only `siteId`, `timeZone`; used by
     the admin). Docblock on `save`: full upsert, only for registering a new device; an existing
     device is changed by concurrent writers (device traffic and admin), so each use case writes
     only its columns (finding `attendance-escritura-completa-del-equipo`).
   - Observable result: typecheck lists the two adapters as incomplete.

2. **Adapters**
   - Files: `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (modify)
   - Do, mapper: `DeviceMapper.toActivity(device)` → `{ lastSeenAt, clockOffsetSeconds,
clockOffsetMeasuredAt }` and `DeviceMapper.toSite(device)` → `{ siteId, timeZone }`.
   - Do, Prisma: `saveActivity` = `attendanceDevice.update({ where: { id: device.id }, data:
DeviceMapper.toActivity(device) })`; `saveSite` likewise with `toSite`. No try/catch: the
     device was just loaded, a missing row is unexpected and must reject.
   - Do, in-memory: both methods read the stored device (missing → reject with an `Error`, as
     Prisma would) and store `Device.restore(stored.id, { ...all props from the stored device's
getters, ...the written fields from the argument })`, so a stale object passed in cannot
     overwrite the other fields (mirrors the Prisma behavior).
   - Observable result: typecheck passes.

3. **Use cases**
   - Files: `apps/api/src/modules/attendance/application/commands/record-device-push.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/assign-device-site.command.ts` (modify)
   - Do: `RecordDevicePush` `:113` and `RecordDeviceContact` `:54` call
     `deviceRepository.saveActivity(device)` instead of `save`. `AssignDeviceSite` calls
     `await deviceRepository.saveSite(device)` and drops the `saved.ok` check (`:35-36`); return
     type stays `Command<AssignDeviceSiteInput, void>`.
   - Observable result: `pnpm check` passes with the existing tests unchanged.

4. **Close the finding**
   - Files: `plans/hallazgos/attendance-escritura-completa-del-equipo.md` (modify)
   - Do: frontmatter `status: resolved`, `plan: attendance-marcaciones/005` (the architect already
     set `planned`); one line at the end: resolved by targeted writes.
   - Observable result: `pnpm plans:lint` passes.

## Acceptance criteria

- [x] Integration (the race, deterministic): two instances of the same device loaded from the DB;
      instance A gets `assignSite(newSite, 'America/Mexico_City')` + `saveSite`; then instance B
      (stale) gets `markSeen` + `recordClockOffset` + `saveActivity`. The row has the new
      `siteId`/`timeZone` **and** B's `lastSeenAt`/offset. Same in the reverse order.
- [x] Running app: `PUT /api/v1/attendance/devices/:id/site` → 204 and `GET /attendance/devices`
      shows the new sede and zone; a `POST /iclock/cdata?table=ATTLOG` push afterwards still
      updates `lastSeenAt` and keeps the new sede.
- [x] Running app: `GET /iclock/getrequest` updates `lastSeenAt` (at most once a minute) as before.
- [x] `POST /api/v1/attendance/devices` still → 201, and a repeated serial → 409
      `DEVICE_ALREADY_REGISTERED`.

## Test layers required

| Layer       | Applies | Focus                                                                                      |
| ----------- | ------- | ------------------------------------------------------------------------------------------ |
| domain      | no      | aggregate unchanged                                                                        |
| application | yes     | push/contact/assign call the targeted method; in-memory stale object does not overwrite    |
| contract    | no      | no contract change                                                                         |
| http        | yes     | acceptance criteria 2–4 over supertest (existing suites must stay green)                   |
| integration | yes     | `saveActivity` / `saveSite` write only their columns; the race of criterion 1, both orders |
| e2e         | no      | (no e2e infrastructure yet)                                                                |

## Deviations

1. **In-memory method takes the written fields explicitly** (cosmetic): `saveActivity`/`saveSite`
   share a private `update(device, fields)` that restores the stored device with those fields;
   same behavior as Step 2.
2. **Environment** (note, no code): the generated Prisma client was stale after a `pnpm install`
   at session start (typecheck failed in every module); `pnpm db:generate` fixed it.
3. **`plans:scope`** against `main` also lists `006-…md` and `007-…md`: they come from the
   plans commit on this branch, not from this plan's code.

Run at the end: `pnpm check` green (api 838 passed / 5 skipped, contracts 259);
`pnpm test:integration` 15 files / 178 tests green. Existing tests unchanged.

## Test coverage

| Behavior (from plan / code)                                                                                                       | Source (`file:line`)                                                            | Layer              | Test                                                                                                                                                            | State     |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `saveActivity` (Prisma) escribe solo `lastSeenAt`/`clockOffsetSeconds`/`clockOffsetMeasuredAt`, sin tocar `siteId`/`timeZone`     | `attendance.mapper.ts:53-58`, `prisma-device.repository.ts:45-49`               | integration        | `prisma-attendance.int.test.ts › escritura dirigida › saveActivity escribe…`                                                                                    | CONFIRMED |
| `saveSite` (Prisma) escribe solo `siteId`/`timeZone`, sin tocar `lastSeenAt`/el desfase                                           | `attendance.mapper.ts:62-63`, `prisma-device.repository.ts:52-56`               | integration        | `prisma-attendance.int.test.ts › escritura dirigida › saveSite escribe…`                                                                                        | CONFIRMED |
| La carrera entre asignar sede y tráfico del equipo no pierde ningún cambio, en cualquier orden (criterio de aceptación 1, Prisma) | `prisma-device.repository.ts:45-56`                                             | integration        | `prisma-attendance.int.test.ts › escritura dirigida › la carrera… (sede-primero / actividad-primero)`                                                           | CONFIRMED |
| `saveActivity`/`saveSite` (Prisma) rechazan sobre un equipo que no existe (sin try/catch)                                         | `prisma-device.repository.ts:44-56`                                             | integration        | `prisma-attendance.int.test.ts › escritura dirigida › saveActivity y saveSite rechazan…`                                                                        | CONFIRMED |
| `InMemoryDeviceRepository.saveActivity`/`saveSite` escriben solo sus columnas (mismo contrato que Prisma)                         | `in-memory-attendance.store.ts:107-141`                                         | application        | `in-memory-attendance.store.test.ts › escritura dirigida`                                                                                                       | CONFIRMED |
| La carrera se resuelve igual en el store en memoria, en cualquier orden                                                           | `in-memory-attendance.store.ts:123-141`                                         | application        | `in-memory-attendance.store.test.ts › la carrera se resuelve igual en cualquier orden…`                                                                         | CONFIRMED |
| `saveActivity`/`saveSite` en memoria rechazan sobre un equipo inexistente                                                         | `in-memory-attendance.store.ts:125`                                             | application        | `in-memory-attendance.store.test.ts › saveActivity y saveSite rechazan…`                                                                                        | CONFIRMED |
| `RecordDevicePush` llama `saveActivity` y nunca `save` al marcar visto / medir desfase                                            | `record-device-push.command.ts:112-113`                                         | application        | `record-device-push.command.test.ts › guarda la actividad con saveActivity y nunca con save (hallazgo M1 de la revisión)` (nuevo, espía el repositorio)         | CONFIRMED |
| `RecordDeviceContact` llama `saveActivity` y nunca `save` al marcar visto                                                         | `record-device-contact.command.ts:53-54`                                        | application        | `record-device-contact.command.test.ts › guarda la actividad con saveActivity y nunca con save (hallazgo M1 de la revisión)` (nuevo, espía el repositorio)      | CONFIRMED |
| `AssignDeviceSite` llama `saveSite` (nunca `save`) y ya no revisa `saved.ok`                                                      | `assign-device-site.command.ts:34-35`                                           | application        | `assign-device-site.command.test.ts › guarda la sede con saveSite y nunca con save (hallazgo M1 de la revisión)` (nuevo, espía el repositorio)                  | CONFIRMED |
| `PUT …/site` → 204 y `GET /attendance/devices` refleja la sede/zona nuevas                                                        | `attendance.router.ts`, `assign-device-site.command.ts`                         | http               | `attendance.test.ts › PUT …/site › equipo sin sede…` (existente)                                                                                                | CONFIRMED |
| Un push tras el cambio de sede conserva la sede nueva y actualiza `lastSeenAt` (criterio de aceptación 2)                         | `record-device-push.command.ts:112-113` + `assign-device-site.command.ts:34-35` | http               | `attendance.test.ts › PUT …/site › un push tras el cambio de sede…` (nuevo)                                                                                     | CONFIRMED |
| `GET /iclock/getrequest` actualiza `lastSeenAt` como máximo cada minuto (criterio de aceptación 3)                                | `device.ts:156-163`                                                             | application        | `record-device-contact.command.test.ts › anota el último contacto…` (existente; wiring http ya cubierto por las suites de `attendance-device-commands.test.ts`) | CONFIRMED |
| `POST /attendance/devices` → 201 y serial repetido → 409 `DEVICE_ALREADY_REGISTERED` (criterio de aceptación 4)                   | `register-device.command.ts`, `prisma-device.repository.ts:27-42`               | http + integration | `attendance.test.ts` (existente) + `prisma-attendance.int.test.ts › un segundo equipo…` (existente)                                                             | CONFIRMED |

Nuevo: `in-memory-attendance.store.test.ts` (application), 5 casos nuevos en `prisma-attendance.int.test.ts`
(integration), 1 caso nuevo en `attendance.test.ts` (http). El resto de las suites existentes del módulo
(application/http/integration) queda sin cambios y en verde: confirman que la escritura dirigida no
rompió el comportamiento anterior.

Cierre: `pnpm check` verde (api y contracts); `pnpm test:integration` verde. Ejecutado completo dos
veces (baseline y cierre), solo lo tocado en medio, según el presupuesto del rol.

**Reparación 2026-10-06** (tester, tras la revisión del commit `51351d5`, hallazgos M1 y L1 de
`## Review findings`):

- **M1**: las tres filas de `RecordDevicePush`/`RecordDeviceContact`/`AssignDeviceSite` decían
  CONFIRMED apoyadas en tests que solo miraban el estado final a través de
  `InMemoryDeviceRepository`, cuyo `findById` devuelve la misma referencia guardada — un `save`
  completo deja el mismo estado que `saveActivity`/`saveSite`, así que esos tests no distinguían
  el método llamado. Se agregó un test por caso de uso que espía el repositorio
  (`vi.spyOn(deviceRepository, 'save' | 'saveActivity' | 'saveSite')`) y confirma que se llama el
  método dirigido y **nunca** `save`: `record-device-push.command.test.ts`,
  `record-device-contact.command.test.ts`, `assign-device-site.command.test.ts`. Las tres filas de
  la tabla se corrigieron para citar estos tests nuevos.
- **L1**: en `prisma-attendance.int.test.ts`, los tests `saveActivity escribe…` y `saveSite
escribe…` leían la instancia "vieja" con `findById` **después** de que el otro escritor ya había
  guardado su cambio, así que esa instancia no era vieja de verdad (un `update` de la fila entera
  habría pasado el test igual). Se corrigió el orden: la instancia stale ahora se carga antes de
  que el otro escritor guarde. Las filas de la tabla no cambiaron de test porque ahora prueban lo
  que decían probar.

Solo se tocaron tests y esta sección; el `status` sigue en `review`. Cierre de la reparación:
`pnpm check` verde (api 846 passed / 5 skipped, +3 por M1; contracts 259); `pnpm test:integration`
verde (15 archivos / 183 tests, sin cambio de conteo: L1 corrigió tests existentes, no agregó).

## Review findings

Revisión 2026-10-06 (reviewer, base del diff `cbff30c`, limitada a los commits `d7f595c` y
`d9dd4b7`; `6e5f411` es del plan 006 y quedó fuera). `status` sigue en `review`: un hallazgo
Medium pide tests nuevos (solo tests, va al tester).

**Checklist: 13/13.**

- [x] `pnpm plans:scope … --base cbff30c` sale con 1 porque HEAD incluye el 006 (37 archivos). Si se
      limita a `d7f595c` + `d9dd4b7`: los 7 archivos de producto y el hallazgo están declarados en
      los `Files:`; quedan fuera solo los 3 archivos de test del tester
      (`in-memory-attendance.store.test.ts`, `tests/attendance.test.ts`,
      `prisma-attendance.int.test.ts`), aceptados como en el plan 004. Sin hot files.
- [x] `pnpm check` verde (19/19 tareas turbo; api 74 archivos de test; arch, plans, harness OK).
- [x] `pnpm test:integration`: 15 archivos / 183 tests verdes (HEAD, incluye el 006).
- [x] Reglas en `domain/`: el agregado no cambia; mapper y adaptadores solo copian columnas.
- [x] CQRS ligero: los commands siguen agregado → `DeviceRepository`; los métodos nuevos son de
      escritura por agregado, no "para pantallas".
- [x] Sin cambios de contrato.
- [x] Errores esperados: `save` conserva `DEVICE_ALREADY_REGISTERED`; `saveActivity`/`saveSite`
      rechazan solo ante lo inesperado (fila ausente), como pide el paso 2.
- [x] Sin dinero; fechas sin cambio; `Clock` sigue en los commands.
- [x] Sin cambio de esquema ni migración (como prometía el plan).
- [x] Sin registros DI nuevos; `container.test.ts` verde.
- [x] Sin secretos ni datos reales (seriales `TESTSN001`, UUIDs sintéticos).
- [x] Deviations honestas: verificada la 1 (`update(device, fields)` privado en
      `in-memory-attendance.store.ts:123`, mismo comportamiento que el paso 2).
- [x] Docs: ninguna describía el workaround de la carrera fuera del hallazgo, que quedó `resolved`.

### Medium

- **M1 — Ningún test falla si un caso de uso vuelve a llamar `save` (o no guarda nada).**
  `record-device-push.command.ts:113`, `record-device-contact.command.ts:54`,
  `assign-device-site.command.ts:35`. La capa application del plan pide "push/contact/assign
  call the targeted method", y el Test coverage lo da por CONFIRMED con los tests existentes. Pero
  esos tests usan `InMemoryDeviceRepository`, cuyo `findById` (`in-memory-attendance.store.ts:88`)
  devuelve la misma referencia guardada, y `save` también guarda la referencia: el estado mutado
  se ve igual con `save`, con `saveActivity` o sin guardar. El test HTTP nuevo tampoco lo detecta
  (PUT y push van en secuencia, el push carga el equipo ya con la sede nueva; un `save` completo
  daría el mismo resultado). Los tests de integración prueban el repositorio, no los commands.
  Escenario: un refactor futuro devuelve `RecordDevicePush` a `deviceRepository.save(device)`;
  `pnpm check` y `test:integration` siguen verdes y la carrera del hallazgo vuelve en producción.
  Arreglo (solo tests, tester): un test por command que lo demuestre, p. ej. un doble de
  `DeviceRepository` que registre qué método se llamó, o un repositorio cuyo `findById` devuelva
  una copia vieja y comprobar que la sede/actividad escrita por el otro no se pierde. Corregir las
  tres filas del Test coverage que hoy dicen CONFIRMED.

### Low

- **L1 — Los dos primeros tests de integración no usan una instancia vieja.**
  `prisma-attendance.int.test.ts:132-150` y `:152-170`. El comentario dice "Snapshot cargado
  antes de la asignación de sede", pero `stalePush` se lee con `findById` **después** de
  `devices.save(device)` con la sede nueva (y en el segundo, `staleAdmin` después de guardar la
  actividad): la instancia ya trae las columnas del otro escritor. Con un `update` de la fila
  entera ambos pasarían igual, así que no prueban "solo sus columnas". La propiedad sí queda
  probada por el `it.each` de la carrera (`:172-201`, dos instancias cargadas antes de escribir),
  por eso es Low. Arreglo (tester): cargar la instancia antes del `save` del otro escritor, o
  corregir el comentario y el Test coverage para que esas filas citen el test de la carrera.

Fuera de alcance, sin hallazgo nuevo: dos pushes concurrentes pueden dejar el `lastSeenAt` del más
viejo; ya pasaba con `save` y es informativo (paso de un minuto), no lo toca este plan.

### Re-revisión 2026-10-06 (commit `5b9a0ad`, reparación del tester)

Limitada al plan 005 (`d7f595c`, `d9dd4b7`, `5b9a0ad`; `6e5f411` es del 006). La reparación
solo toca tests y la sección Test coverage (5 archivos: los 3 tests de commands, el de
integración y este plan). Sin cambios de producto, así que la checklist anterior (13/13) sigue
valiendo. Se volvió a correr: `pnpm check` verde (19/19 tareas turbo); los 4 archivos unitarios
afectados, 53 tests verdes; `tests/integration/attendance`, 3 archivos / 38 tests verdes.

- **M1 — RESUELTO.** Hay un test nuevo con espía por caso de uso:
  `record-device-push.command.test.ts:131`, `record-device-contact.command.test.ts:209` y
  `assign-device-site.command.test.ts:63`. Cada uno espía el repositorio **después** del alta
  hecha con `save` en `setUp`, y comprueba que el método dirigido se llama 1 vez y `save` 0 veces.
  Fallarían en los dos casos: si el command volviera a `save` (el espía de `save` lo detecta) y si
  no guardara nada (el método dirigido tendría 0 llamadas). Esto lo comprobé leyendo el código; no
  muté el producto, porque el reviewer no edita código. Los escenarios sí escriben: el push trae
  una marcación con un equipo nunca visto (`markSeen` → `true`), el contact es el primer contacto,
  y assign usa una sede activa. Las tres filas del Test coverage citan ahora estos tests.
- **L1 — RESUELTO.** En `prisma-attendance.int.test.ts`, `stalePush` (`saveActivity escribe…`) y
  `staleAdmin` (`saveSite escribe…`) se leen con `findById` **antes** de que el otro escritor
  guarde (ahora con `saveSite`/`saveActivity`). Prisma devuelve un objeto nuevo en cada lectura,
  así que la copia sí es vieja. Si el método bajo prueba escribiera la fila entera, sobrescribiría
  la sede (o la actividad) del otro escritor y el test fallaría.
- Nota sin impacto: la nota de reparación del Test coverage cita la revisión como commit
  `51351d6`; el hash real es `51351d5`.

Sin hallazgos abiertos. Plan 005 a `verify`.

## Verification

**PASS** — 2026-10-06, main session, at `a9b806b` (HEAD also carries plan 006 code), against the
dev API on `localhost:3001` (`pnpm dev:api`; dev DB seeded with `pnpm db:seed`).

- Suites: `pnpm check` green (api 846 passed / 5 skipped, contracts 259, domain 98);
  `pnpm test:integration` 15 files / 183 tests green.
- Criterion 1 (the race, both orders): covered by the integration tests in
  `prisma-attendance.int.test.ts` (green above); not reproducible by hand over HTTP.
- Script over HTTP and `/iclock` (synthetic sedes `Verificación 005 A|B <suffix>`, devices
  `VER005<suffix>` and `VER005B<suffix>`, suffix `MUX3G8X8`), 13/13 PASS:
  - [x] Criterion 2: `PUT …/devices/:id/site` → 204; the list shows the new sede and
        `America/Mexico_City`; a `POST /iclock/cdata?table=ATTLOG` afterwards → `OK: 1`, sets
        `lastSeenAt` and the clock offset, and keeps the new sede and zone.
  - [x] Criterion 3: `GET /iclock/getrequest` on a fresh device → `OK`, sets `lastSeenAt`, keeps
        the sede; an immediate second poll does not rewrite it.
  - [x] Criterion 4: `POST /attendance/devices` → 201; repeated serial → 409
        `DEVICE_ALREADY_REGISTERED`.
  - Unhappy path: `PUT …/site` on an unknown device → 404 `DEVICE_NOT_FOUND`.
- API log during the run: no error lines.
- Data left in the dev DB: the two sedes and two devices above (one punch, PIN `9100`).
