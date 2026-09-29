# 0011 — Sesiones opacas en Postgres

- **Estado**: Aceptado
- **Fecha**: 2026-09-29

## Contexto

Hasta el plan 001 de `plans/identity-acceso/` no había autenticación en el API: `createApp` monta
todos los routers sin ningún paso de auth y ningún handler sabe quién llama. `docs/architecture.md`
(sección "Pendiente") y el registro de `docs/harness/modules.json` anticipaban "access + refresh
token, apto para mobile" para el módulo `identity`, sin que existiera diseño ni implementación.

Había que elegir el mecanismo de sesión antes de escribir el módulo `identity` (usuarios, login,
logout, contexto de request). Las dos opciones evaluadas fueron JWT de acceso + refresh, o
sesiones opacas guardadas en Postgres. `plans/identity-acceso/README.md` (decisión 4) ya resolvió
esto durante la planificación; este ADR registra la decisión para que quede fuera del plan (que se
puede reemplazar) y visible para el resto del código.

## Decisión

Sesiones **opacas** server-side:

- El token de sesión es aleatorio (256 bits, `randomBytes(32)` en base64url); nunca codifica
  claims. Solo su hash SHA-256 (hex, 64 caracteres) se guarda en `identity.sessions.token_hash`
  — un token de esa entropía no necesita un hash lento, a diferencia de una contraseña.
- Web: el token viaja en una cookie `__Host-rrhh_session` (`httpOnly`, `Secure`, `SameSite=Lax`,
  `Path=/`). El prefijo `__Host-` fuerza que el navegador exija `Secure`, `Path=/` y sin `Domain`.
  Como defensa adicional a `SameSite=Lax`, las peticiones que mutan estado autenticadas por cookie
  exigen un header `Origin` presente y dentro de `CORS_ORIGINS`.
- Mobile: el token viaja como `Authorization: Bearer <token>`, sin cookie (no hay navegador que la
  envíe automáticamente).
- Contraseñas: `argon2id` vía `crypto.argon2` de `node:crypto` (disponible desde Node 24.7), con
  los parámetros mínimos del OWASP Password Storage Cheat Sheet (memoria 19 MiB, 2 iteraciones,
  paralelismo 1), codificados en un string PHC estándar para poder subir los parámetros más
  adelante sin invalidar los hashes existentes.
- Throttling de login (15 min de ventana, bloqueo 15 min) como entidad de dominio persistida en
  Postgres, misma razón de durabilidad que las sesiones. Límites separados por correo (5 intentos)
  y por IP (`LOGIN_IP_MAX_FAILURES`, 50 por defecto): una IP compartida (oficina, reverse proxy)
  no debe agotar, con el límite pensado para un atacante, el login de todo el mundo detrás de ella.
- Autenticación como middleware global en `src/http/` que resuelve el token (Bearer o cookie) a
  través de un puerto compartido `RequestAuthenticator`, implementado por `identity`. `bindRoute`
  pasa un `RequestContext` (actor, ip/user-agent, cookie jar) como segundo argumento a cada
  handler; ningún endpoint queda protegido por este plan salvo `/auth/logout` y `/auth/me`.

## Alternativas consideradas

- **JWT de acceso + refresh**: sin ida a la base en cada request (el JWT se valida localmente),
  pero revocar una sesión requiere una lista de revocación igual de stateful que una tabla de
  sesiones, así que la ganancia de "sin estado" es parcial. Además complica el logout instantáneo
  (invalidar un JWT ya emitido) y el conteo de sesiones activas por usuario, que el negocio va a
  necesitar (plan 003). Se descarta por ahora: la complejidad de dos tokens y su rotación no paga
  su costo frente a una sesión opaca simple.
- **Cache de sesiones en Valkey** en vez de (o adelante de) Postgres: reduce la latencia de la
  consulta por request, pero introduce una segunda fuente de verdad que puede desincronizarse de
  la base, y el volumen esperado no lo justifica todavía. Queda fuera de alcance de este plan
  (ver "Consecuencias"); es la primera optimización a considerar si la latencia importa.

## Consecuencias

- Cada request autenticado hace una consulta indexada a `identity.sessions` (por `token_hash`,
  columna `@unique`). Aceptable para el volumen actual; un cache es la vía si deja de serlo.
- Revocar una sesión (logout, deshabilitar usuario) es instantáneo: no hay que esperar a que
  expire un token como con JWT.
- No hay flujo de refresh token que mantener ni rotar.
- El servidor requiere Node ≥ 24.7 por `crypto.argon2` (antes no había una razón para fijar un
  mínimo tan específico); `package.json` (`engines.node`) y `apps/api/Dockerfile` (`node:24`) ya
  cumplen.
- **Señal para revisar**: la consulta de sesión por request se vuelve un cuello de botella medido
  (no solo sospechado), momento en el que evaluar un cache de sesiones en Valkey con invalidación
  por evento (`identity.session.revoked`) en vez de reemplazar el mecanismo completo.
- Cada intento de login se reserva bajo un row lock (`SELECT … FOR UPDATE`) antes de verificar la
  contraseña, dentro de una transacción por llave (correo, IP): así una ráfaga concurrente cuenta
  cada intento en vez de perder incrementos por lecturas simultáneas del mismo contador (H3, ronda
  1 de revisión del plan 001).
