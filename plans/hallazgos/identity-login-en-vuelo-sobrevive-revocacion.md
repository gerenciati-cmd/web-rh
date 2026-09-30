---
status: resolved
module: identity
found: 2026-09-30
plan: identity-acceso/006
---

# Hallazgo: un login en vuelo sobrevive a "cerrar todas las sesiones"

Origen: revisión del plan `identity-acceso/005` (bug hunt). No es de ese plan: `LogIn` no cambió.

## Qué se observó

- `LogIn` lee el usuario y verifica la contraseña sin bloquear la fila del usuario, y guarda la
  sesión después, sin transacción compartida con quien revoca
  (`apps/api/src/modules/identity/application/commands/log-in.command.ts:91-125`).
- `SessionRepository.revokeAllForUser` solo revoca las sesiones que existen en ese momento
  (`apps/api/src/modules/identity/infrastructure/prisma-session.repository.ts:31-37`).
- Quien cierra todas las sesiones (`ResetPassword` del plan 005, `DisableTerminatedEmployee`)
  no puede excluir a un `LogIn` que ya pasó la verificación.

Secuencia: (1) `LogIn` lee el usuario ACTIVO y verifica la contraseña vieja (argon2); (2)
mientras, `ResetPassword` (o la baja) cambia el hash / deshabilita, ejecuta `revokeAllForUser` y
confirma; (3) `LogIn` guarda su `Session` nueva, que no fue revocada.

No reproducido con una prueba; deducido del código.

## Impacto

- Ventana corta: la verificación argon2 más la escritura de la sesión.
- Quien conoce la contraseña vieja y acierta la ventana conserva una sesión tras el
  restablecimiento; en la baja, un colaborador recién desvinculado conserva una sesión.
- No afecta la contraseña nueva ni permite fijar contraseñas.

## Propuesta

- (a) En `LogIn`, guardar la sesión dentro de una transacción con `UserRepository.lock` que relea
  hash y estado antes de guardar. Coste: un lock por login.
- (b) Al autenticar cada request, rechazar sesiones creadas antes de un `password_changed_at` /
  `disabled_at` del usuario. Coste: columna nueva y chequeo por request.
- (c) Aceptar el riesgo y documentarlo.
