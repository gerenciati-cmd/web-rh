---
status: open
module: employees
found: 2026-10-12
---

# Hallazgo: un cambio de sede o RFC concurrente puede deshacer en silencio una baja

Origen: revisión del plan `employees-desvinculacion/001` (Medium-1). Fuera de su alcance: el
arreglo toca el repositorio de colaboradores y todos sus comandos, no solo la baja. Mismo patrón
que el hallazgo resuelto `attendance-escritura-completa-del-equipo.md`.

## Qué se observó

- `apps/api/src/modules/employees/infrastructure/prisma-employee.repository.ts:43-47` guarda el
  agregado `Employee` completo (`upsert` de toda la fila, sin versión ni condición).
- `AssignEmployeeSite` (`assign-employee-site.command.ts:39,53`), `AssignEmployeeRfc`
  (`assign-employee-rfc.command.ts:32,45`) y el nuevo `TerminateEmployee`
  (`terminate-employee.command.ts:34,46`) cargan la fila,
  la modifican en memoria y la guardan entera.
- Antes del plan 001 nada en producción llamaba a `terminate`; ahora el endpoint
  `POST …/employees/:employeeId/termination` hace alcanzable la carrera.
- Escenario A (baja revertida): RH cambia la sede (`PUT …/site`) mientras otra persona registra
  la baja. El PUT cargó la fila `ACTIVE`; la baja guarda `TERMINATED` con fecha y motivo; el PUT
  guarda después `status: ACTIVE`, `termination_date`/`termination_reason` en null. El
  directorio vuelve a mostrar al colaborador activo y sin baja. Identity ya deshabilitó su acceso
  (por `EMPLOYEE_TERMINATED`), y el `EMPLOYEE_SITE_ASSIGNED` del PUT hace que attendance
  (`attendance.module.ts:108-120`, `syncEmployee` lee el estado actual) lo vuelva a dar de alta
  en los checadores de la nueva sede. Estado inconsistente entre módulos.
- Escenario B (doble envío): dos `POST …/termination` simultáneos (doble clic) cargan ambos la
  fila `ACTIVE`; los dos responden 204, el segundo pisa fecha y motivo del primero y se publican
  dos `EMPLOYEE_TERMINATED`. Sin reproducir; consumidores probablemente idempotentes (no
  verificado).
- No reproducido en ninguno de los dos casos; la ventana es corta (milisegundos entre `findById`
  y `save`).

## Impacto

Escenario A: un colaborador dado de baja aparece activo, sin fecha ni motivo de baja, sin acceso
a la plataforma pero de nuevo en los checadores. El dato de baja (base del futuro finiquito) se
pierde sin error. Escenario B: fecha/motivo finales dependen del orden de llegada. No afecta a
otras empresas ni filtra datos.

## Propuesta

- Escrituras dirigidas por caso de uso en `EmployeeRepository` (como se hizo con
  `DeviceRepository`: `saveSite`, `saveRfc`, `saveTermination` con `WHERE status = 'ACTIVE'`
  para la baja), o
- versión optimista en `employees.employees` (columna `version`, `update … where version = n`,
  conflicto → error de dominio 409).
  El usuario decide si va en un plan nuevo de `employees-desvinculacion` o en el que vuelva a tocar
  el repositorio de colaboradores.
