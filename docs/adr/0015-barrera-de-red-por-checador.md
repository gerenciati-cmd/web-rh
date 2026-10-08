# 0015 — Barrera de red por checador en `/iclock`

- **Estado**: Aceptado
- **Fecha**: 2026-10-05
- **Reemplaza en parte**: [0014](0014-comandos-salientes-con-serial-como-credencial.md) (el punto
  "no se agrega código de barrera en el API")

> Se escribió como ADR 0014 en una rama paralela a la que creó el ADR 0014 vigente; se renumeró
> al integrar ambas (2026-10-08). Aquí "plan 006" es la sincronización de colaboradores, hoy
> `attendance-marcaciones/007`, y el plan que lo implementa es `attendance-marcaciones/008`.

## Contexto

El ADR 0013 deja el número de serie (`SN`) como única credencial del checador: ADMS no ofrece
otra, y el serial viene impreso en la etiqueta del equipo. Mientras `/iclock` solo recibía
marcaciones, el riesgo era que alguien inyectara marcaciones falsas. Desde el plan
`attendance-marcaciones/004`, `GET /iclock/getrequest` además **entrega** los comandos encolados,
que llevan el RFC y el nombre del colaborador: quien conozca el serial puede consultar antes que
el equipo, llevarse esos datos y dejar el comando como entregado, así que el equipo real nunca lo
recibe (revisión M1 del plan 004). La sincronización de colaboradores (plan 006) multiplicaría
esos comandos.

Todavía no está decidido cómo se conectan las sedes en producción (IP pública fija, IP dinámica o
VPN). La protección no puede depender de esa decisión.

## Decisión

- Cada checador tiene una lista de **redes IPv4 permitidas** (dirección o CIDR, hasta 10), que se
  define con `PUT /api/v1/attendance/devices/:deviceId/networks` (permiso
  `attendance.devices:manage`). Los casos de uso de `/iclock` comparan la IP de origen del request
  con esa lista; desde afuera de ella el equipo recibe el mismo `403 ERROR: dispositivo no
autorizado` que un serial desconocido, y el log registra `zkteco: IP no permitida`.
- Un checador **sin** redes permitidas sigue enviando marcaciones desde cualquier IP (nada se rompe
  al desplegar), pero **no recibe comandos**: encolar responde 422 `DEVICE_NETWORK_UNRESTRICTED`
  y los comandos pendientes no se entregan.
- La IP de origen es `req.ip` de Express. Detrás de un proxy, la variable `TRUST_PROXY` define en
  qué proxies se confía para leer `X-Forwarded-For`; sin ella se usa la IP del socket.
- `GET /api/v1/attendance/devices` muestra `lastSeenIp` (IP del último contacto) para saber qué
  red permitir.
- Solo IPv4: los equipos ADMS se conectan por IPv4, y así el cálculo de redes queda en el dominio,
  sin `node:net`. Un origen IPv6 se rechaza si el equipo tiene redes.

## Alternativas consideradas

- **Solo una barrera de red (firewall, proxy o VPN)**: no requiere código, pero depende de una
  topología que aún no existe, y si la red queda mal configurada la app no se protege sola.
  Puede sumarse encima de esta decisión.
- **Aceptar el riesgo y documentarlo**: el RFC y el nombre saldrían a cualquiera que conozca el
  serial impreso en el equipo.

## Consecuencias

- El serial sigue siendo una credencial débil: un atacante dentro de una red permitida (la LAN de
  la sede, o la misma IP pública detrás de NAT) puede hacerse pasar por el equipo. La barrera
  reduce quién puede intentarlo; no lo impide.
- Una sede con IP dinámica obliga a permitir un rango más amplio o a contratar IP fija.
- Un `TRUST_PROXY` demasiado amplio deja que cualquier cliente falsee su IP con
  `X-Forwarded-For` y anula la barrera. También afecta al límite de intentos de login, que usa la
  misma IP.
- Señal para revisar: si el firmware ofrece TLS con certificado de cliente o una clave de
  comunicación verificable, esa credencial debería reemplazar o complementar esta barrera.
