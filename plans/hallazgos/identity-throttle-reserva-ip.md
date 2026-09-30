---
status: resolved
module: identity
found: 2026-09-29
plan: identity-acceso/002
---

# Hallazgo: la reserva del cupo por IP ocurre aunque el correo ya esté bloqueado

Origen: segunda ronda de revisión del plan `identity-acceso/001` (L3, I4, I6). El usuario decidió
dejarlo como hallazgo y resolverlo en el plan 002, que vuelve a tocar `identity`.

## Qué se observó

- **L3 (Low)**: `apps/api/src/modules/identity/application/commands/log-in.command.ts:145-158`
  reserva los intentos de cada llave en orden (correo, luego IP). Si la llave del correo sale
  bloqueada, igual se reserva la de la IP y después se libera. Si la IP estaba en 49 de 50
  (`LOGIN_IP_MAX_FAILURES`), durante esos milisegundos queda en 50 y otro login legítimo desde la
  misma IP recibe 429 con un `Retry-After` de unos 900 s.
- **I4 (Info)**: los comentarios de `domain/login-throttle.ts` (`releaseAttempt`) y de
  `log-in.command.ts:154-155` afirman que un bloqueo "solo pudo originarse en esta misma reserva".
  Con concurrencia, la reserva de otra petición también puede fijarlo. El comportamiento es
  correcto; el razonamiento del comentario no lo es.
- **I6 (Info)**: el test de "bloqueado por IP" en `log-in.command.test.ts` no comprueba que la
  reserva del correo se libere después.
- **I5 (Info, sin reproducir)**: una ráfaga muy grande sobre una misma llave podría agotar el
  pool de conexiones mientras las peticiones esperan el row lock. Esas peticiones recibirían 500
  en vez de 429. Falla del lado seguro: ninguna llega a verificar una contraseña.

## Impacto

- L3: una ventana de milisegundos que solo afecta a una IP compartida ya al borde de su límite.
  No permite evadir el throttle ni revela cuentas.
- I4 e I6: mantenibilidad y cobertura; ningún efecto en runtime.
- I5: disponibilidad bajo ataque, no seguridad.

## Propuesta

- L3: dejar de reservar las llaves siguientes en cuanto una sale bloqueada (unas 5 líneas en
  `reserveOrBlock`) y agregar su test.
- I4: corregir los dos comentarios.
- I6: agregar la aserción que falta.
- I5: medir con una prueba de carga antes de decidir (limitar la concurrencia por llave o
  responder 429 cuando no se obtiene el lock a tiempo).
