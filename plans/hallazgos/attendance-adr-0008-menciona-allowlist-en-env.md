---
status: open
module: attendance
found: 2026-10-01
---

# Hallazgo: el ADR 0008 sigue describiendo la allowlist en `.env`

## Qué se observó

`docs/adr/0008-endpoints-de-dispositivos-fuera-de-contratos.md:24` exige como autenticación del
equipo una "allowlist de números de serie en configuración (`ZKTECO_ALLOWED_SERIALS`)". El plan
`attendance-marcaciones/001` elimina esa variable y la reemplaza por un registro de equipos en la
base de datos (`attendance.devices`, `POST /api/v1/attendance/devices`).

## Impacto

Solo documentación: el ADR describe un mecanismo que ya no existe. No afecta al código.

## Propuesta

Actualizar el punto de "Autenticación del equipo" del ADR para decir que el equipo debe estar
registrado y activo en el registro de `attendance`, o agregar una nota que lo supere. Decide el
usuario.
