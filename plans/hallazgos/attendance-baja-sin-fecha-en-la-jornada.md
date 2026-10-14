---
status: planned
module: attendance
found: 2026-10-14
plan: attendance-asistencia-diaria/002
---

# Hallazgo: un colaborador dado de baja sin fecha guardada se trataría como empleado sin fin

Origen: revisión del plan `employees-fechas-laborales/001` (Medium-1). Fuera de su alcance: el
riesgo está en el consumidor, `attendance-asistencia-diaria/002` (aún sin implementar).

## Qué se observó

- El agregado admite bajas sin fecha: `termination` es "nulo mientras está activo, y en bajas
  anteriores al campo" (`apps/api/src/modules/employees/domain/employee.ts:45-47`); el mapper solo
  arma `termination` si hay fecha y motivo
  (`apps/api/src/modules/employees/infrastructure/employee.mapper.ts:30-32`).
- Por eso `EmployeeSummary.terminationDate` es `null` también para un `TERMINATED` sin fecha
  guardada; solo `active: false` lo distingue
  (`apps/api/src/modules/employees/application/employees.facade.ts:55-57`).
- El puerto planeado `WorkdayEmployeeDirectory.find` del plan
  `attendance-asistencia-diaria/002` (paso 4, `002-jornada-diaria-guardada.md:182-184`) copia
  `hireDate` y `terminationDate` pero no `active`, y la decisión 18 del README de esa serie
  construye jornadas "entre la fecha de contratación y la de baja".

## Impacto

Si existen filas de bajas anteriores al campo, `RecalculateWorkdays` generaría jornadas (y
posibles faltas) para un desvinculado desde su contratación hasta el rango pedido. No afecta a
colaboradores activos ni a bajas registradas con fecha. No se verificó cuántas filas así existen
(NOT CONFIRMED en datos reales).

## Propuesta

- A: agregar `active` al puerto de 002 y negarse a calcular (o tratar como sin jornada) a un
  inactivo sin `terminationDate`. Simple; decisión de negocio sobre qué mostrar.
- B: backfill de `termination_date` para esas filas (migración de datos con fecha acordada por
  RRHH). Elimina el caso, pero requiere la fecha real.
- C: aceptar el riesgo si se confirma que no hay filas así.

## Decisión (sesión principal, 2026-10-14)

Opción A, planeada en `attendance-asistencia-diaria/002` (paso 4): el puerto incluye `active` y
un desvinculado sin `terminationDate` responde 422 `EMPLOYEE_INACTIVE` sin escribir jornadas. En
la base de desarrollo no hay filas así (`TERMINATED` sin fecha: 0 de 4); aún no hay producción.
