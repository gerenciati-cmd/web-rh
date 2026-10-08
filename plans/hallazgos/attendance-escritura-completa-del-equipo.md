---
status: resolved
module: attendance
found: 2026-10-02
plan: attendance-marcaciones/005
---

# Hallazgo: un push del checador puede deshacer en silencio el cambio de sede

Origen: revisión del plan `attendance-marcaciones/003` (Low-1). La sesión principal lo dejó como
hallazgo porque el arreglo es una decisión de diseño que el plan no contemplaba.

## Qué se observó

- `apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts:27-34` guarda el
  agregado `Device` completo (upsert de toda la fila).
- `RecordDevicePush` y `RecordDeviceContact` cargan el equipo, trabajan y lo guardan entero. Antes
  del plan 003 solo cambiaban `lastSeenAt`; ahora la fila también tiene datos que escribe el admin
  (`siteId`, `timeZone`).
- Escenario: el admin asigna la sede (`PUT …/devices/:id/site`, 204) mientras el equipo sube un
  historial largo. El push cargó la sede y la zona viejas y guarda después del PUT: la lista
  vuelve a mostrar la sede vieja y las marcaciones siguientes se convierten con la zona vieja.
  No reproducido; la ventana es corta pero cae justo en la instalación, cuando ocurren las dos cosas.

## Impacto

Marcaciones convertidas a UTC con la zona equivocada hasta que alguien note la sede vieja y
repita el PUT. El desfase de reloj (plan 003) lo delataría si la zona difiere en horas.

## Propuesta

Que los casos de uso del equipo escriban solo las columnas que cambian (un `update` dirigido por
caso de uso: `lastSeenAt`, desfase, sede), o versión optimista en `attendance.devices`. Cabe en
el plan que vuelva a tocar el repositorio de equipos (004 o 005). Mientras tanto, en la
instalación: asignar la sede antes de conectar el equipo, o repetir el PUT y confirmar con
`GET /attendance/devices`.

## Resolución

Resuelto dos veces en ramas paralelas, con el mismo enfoque: `attendance-marcaciones/005`
(2026-10-06, `saveActivity` / `saveSite`) y `attendance-marcaciones/008` (2026-10-05, numerado 005
en su rama). Al integrarlas (2026-10-08) quedaron los nombres del 008: `DeviceRepository.save` se
reemplazó por escrituras dirigidas: `add` (alta), `saveContact` (lo que escribe el equipo:
`lastSeenAt`, `lastSeenIp`, desfase), `saveSite` (`siteId`, `timeZone`) y `saveAllowedNetworks`.
Un envío del equipo ya no pisa la sede ni la zona. Queda una limitación documentada en el runbook:
las marcaciones del envío que estaba en curso al cambiar la sede se convierten con la zona anterior.
