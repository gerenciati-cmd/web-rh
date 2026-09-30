---
status: planned
module: identity
found: 2026-09-30
plan: identity-acceso/005
---

# Hallazgo: dos invitaciones simultáneas al mismo colaborador quedan ambas pendientes

Origen: revisión del plan `identity-acceso/003` (L3). El usuario decidió dejarlo como hallazgo.

## Qué se observó

- `InviteEmployee` (`apps/api/src/modules/identity/application/commands/invite-employee.command.ts`)
  anula las invitaciones pendientes leyendo y luego escribiendo, sin lock ni restricción única.
  `InviteExternal` sigue el mismo patrón con el correo.
- Dos peticiones concurrentes para el mismo colaborador (o correo) no se ven entre sí: ambas
  crean su invitación pendiente y encolan dos correos con dos tokens válidos.

## Impacto

- Contenido: la primera activación liga la cuenta y el segundo token responde 409
  (`EMPLOYEE_ALREADY_HAS_ACCESS`, o `EMAIL_ALREADY_REGISTERED` en una invitación externa). No se
  crean usuarios ni roles duplicados.
- Molestia: el colaborador recibe dos correos (por ejemplo, un doble clic en "Invitar").

## Propuesta

Serializar la emisión por colaborador y por correo: un row lock sobre las invitaciones pendientes
del colaborador, o un índice único de "una pendiente por colaborador" cuando Prisma permita
índices parciales (ver decisión 18 del README de `identity-acceso`).
