# ZKTeco SenseFace 2A — sonda ADMS

Runbook de la sonda del módulo `attendance`
(plan `plans/attendance-sonda-zkteco/001-recepcion-adms-solo-log.md`, ADR 0008; autenticación por registro en BD:
ADR 0013; comandos salientes: ADR 0014; barrera de red: ADR 0015).

## Qué hace y qué no

El API atiende el protocolo push ADMS del equipo: handshake, marcaciones (`ATTLOG`),
operaciones y usuarios (`OPERLOG`), biometría (`BIODATA`, `BIOPHOTO`, `USERPIC`) y datos del
equipo (`options`).

- Solo atiende equipos **registrados** (`POST /api/v1/attendance/devices`, solo HOLDING_ADMIN) y
  activos; cualquier otro recibe 403. Si el equipo tiene redes permitidas, también se rechaza
  (403) un request que llegue desde otra IP (ver "Redes permitidas").
- Las marcaciones `ATTLOG` se guardan sin duplicados (el equipo reenvía su historial en cada
  handshake), con la hora local tal como llegó y su instante UTC, calculado con la zona horaria
  del equipo registrado.
- Las demás tablas (`OPERLOG`, `BIODATA`, `options`…) siguen **solo en el log**.
- El estado de cada equipo (último contacto, última marcación) se consulta con
  `GET /api/v1/attendance/devices`; las marcaciones, con `GET /api/v1/attendance/punches`
  (HOLDING_ADMIN todas; RRHH solo las de colaboradores de sus empresas, ver "Atribución").
- Solo envía al equipo los comandos `USERINFO` que un HOLDING_ADMIN encola a mano (ver "Sonda de
  comandos"); sin comando pendiente, `getrequest` responde `OK`.
- Asocia el PIN a un colaborador solo cuando coincide con su RFC (ver "Atribución").
- Plantillas, fotos (`Tmp`, `Content`), nombres, claves y tarjetas **nunca** aparecen en el log:
  salen como `[redactado:<largo>]`.

## Equipo probado

SenseFace 2A, firmware `ZAM70-NF24HA-Ver3.3.12`, PushVersion `Ver 3.1.2S-20250616`.

## Configuración

1. Crea primero la sede (`POST /api/v1/sites`) y registra el equipo como HOLDING_ADMIN con su
   número de serie y el `siteId` de esa sede. La zona horaria del equipo se copia de la sede (la
   hora local que manda el equipo se interpreta en esa zona; Cancún es `America/Cancun`):

   ```sh
   curl -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
     -d '{"serialNumber":"TESTSN001","name":"Entrada principal","siteId":"<id de la sede>"}' \
     http://localhost:3001/api/v1/attendance/devices
   ```

   Un serial ya registrado responde 409; una sede inexistente, 404 `SITE_NOT_FOUND`; una sede
   inactiva, `SITE_INACTIVE`; un equipo no registrado recibe 403 en `/iclock`.
   Para equipos registrados antes de que existieran las sedes (sin sede), o para moverlos de
   sede, usa `PUT /api/v1/attendance/devices/:id/site` con `{"siteId":"…"}`: responde 204 y
   actualiza también la zona horaria del equipo. Asigna la sede **antes** de conectar el equipo:
   si la cambias mientras sube su historial, las marcaciones de ese envío en curso se convierten
   con la zona anterior (los envíos siguientes ya usan la nueva; el cambio de sede no se pierde).

2. Para ver cada registro, usa `LOG_LEVEL=debug`. En `info` solo se ve el resumen por envío. Las líneas `request completed` del sondeo
   (`GET /iclock/getrequest`, cada ~10 s) aparecen solo con `LOG_LEVEL=debug`; si fallan (p. ej. 403) se ven siempre.
3. Levanta el API (`pnpm dev:api`). Escucha en `PORT` (3001 por defecto) en todas las interfaces.
4. El equipo debe poder llegar a tu máquina: abre ese puerto TCP de entrada en el firewall,
   idealmente solo para la IP del equipo.
5. En el equipo, menú de comunicación → "Modo servidor ADMS":
   - "Habilitar nombre de dominio": apagado. Al apagarlo aparece "Puerto del servidor".
   - "Dirección del servidor": la IP de tu máquina en la LAN.
   - "Puerto del servidor": el valor de `PORT`.
   - "Habilitar servidor proxy": apagado.

## Redes permitidas

Cada equipo tiene una lista de redes IPv4 (IP o rango CIDR, hasta 10) desde las que puede
conectarse a `/iclock` (ADR 0015).

1. Conecta el equipo y consulta `GET /api/v1/attendance/devices`: `lastSeenIp` es la IP desde la
   que llegó su último contacto.
2. Permite esa IP (o el rango de la sede) como HOLDING_ADMIN:

   ```sh
   curl -X PUT -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
     -d '{"allowedNetworks":["192.168.1.50"]}' \
     http://localhost:3001/api/v1/attendance/devices/<id>/networks
   ```

   Responde 204; la lista se guarda canónica (`192.168.1.50/32`). Una lista vacía (`[]`) quita la
   restricción.

- **Sin redes permitidas el equipo no recibe comandos**: sigue enviando marcaciones desde
  cualquier IP, pero encolar responde 422 `DEVICE_NETWORK_UNRESTRICTED` y los comandos que ya
  estaban pendientes se quedan en cola (`QUEUED`) hasta que tenga redes.
- Desde una IP fuera de la lista, el equipo recibe `403 ERROR: dispositivo no autorizado` y el
  log escribe `zkteco: IP no permitida` con el serial y la IP.
- Detrás de un reverse proxy, configura `TRUST_PROXY` (por ejemplo `1` si hay un solo proxy
  delante); si no, el API ve la IP del proxy y no la del equipo. No pongas un valor más amplio que
  tus proxies reales: cualquiera podría falsear su IP con `X-Forwarded-For`.
- Una sede con IP pública dinámica necesita un rango más amplio o una IP fija. Solo IPv4.

## Atribución

Da de alta a cada persona en el equipo con su RFC (13 caracteres, en mayúsculas) como ID de
usuario/PIN. El API atribuye cada marcación cuyo PIN coincide con el RFC de un colaborador: esa
marcación es del colaborador y pertenece a su empresa (RRHH ve las de sus empresas; las marcaciones
sin RFC coincidente solo las ve el administrador del holding). La atribución se resuelve al leer, así
que un RFC capturado después alcanza también las marcaciones anteriores. Captura los RFC faltantes
con `PUT …/employees/:id/rfc`.

## Desfase de reloj

Con `Realtime=1` el equipo envía cada marcación al ocurrir. Cuando un envío ATTLOG trae
exactamente una línea válida, el API mide `hora de recepción − hora de la marcación` (segundos) y la
guarda en el equipo (`clockOffsetSeconds`, `clockOffsetMeasuredAt` en `GET …/devices`). Si el valor
absoluto supera 5 minutos (300 s), `clockSuspect` es `true` y el API escribe en el log (nivel warn)
`zkteco: desfase de reloj`: el reloj del equipo está mal, o la sede asignada tiene otra zona
horaria. Los envíos con varias líneas (reenvío de historial) no se miden, porque sus marcaciones
viejas parecerían un desfase enorme. Limitación: una marcación retrasada por una caída de red y
enviada sola también parece desfasada.

## Simular el equipo con curl

Usa un SN ficticio ya registrado (por ejemplo `TESTSN001`) y datos sintéticos:

```sh
# Handshake: responde el bloque de opciones
curl 'http://localhost:3001/iclock/cdata?SN=TESTSN001&options=all'

# Marcación (formato observado: tabs y tab final)
curl -X POST -H 'Content-Type: text/plain' \
  --data-binary $'1\t2026-09-28 08:01:00\t0\t1\t0\t0\t0\t0\t0\t0\t\n' \
  'http://localhost:3001/iclock/cdata?SN=TESTSN001&table=ATTLOG'

# Consulta de comandos
curl 'http://localhost:3001/iclock/getrequest?SN=TESTSN001'
```

## Sonda de comandos

Sirve para descubrir, contra el equipo real, qué comando crea un usuario con PIN alfanumérico y
cómo responde. La familia `DATA UPDATE|QUERY|DELETE USERINFO` sale de la literatura del protocolo
PUSH de ZKTeco. **Confirmado el 2026-10-03** con el SenseFace 2A de la tabla de abajo: este texto
creó al usuario con PIN alfanumérico (los `\t` son tabuladores reales; en JSON se escriben `\t`):

```
C:1:DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0
```

`QUERY` también se confirmó el 2026-10-03 (respuesta `ID=4&Return=0&CMD=DATA`: `ID` repite el
número de `C:<n>:`, `Return=0` es éxito y `CMD` es solo el verbo). `DELETE` sigue sin probarse.

- Encolar (HOLDING_ADMIN): `POST /api/v1/attendance/devices/:deviceId/commands` con
  `{ "command": "DATA UPDATE USERINFO …" }`, **sin** prefijo `C:<n>:`: el API asigna el número
  (plan 006). Solo se aceptan comandos `USERINFO`; cualquier otro texto, o uno con prefijo,
  responde 400. El equipo debe tener redes permitidas (ver "Redes permitidas"); si no, 422
  `DEVICE_NETWORK_UNRESTRICTED`.
- Entrega: el siguiente `GET /iclock/getrequest` de ese equipo responde `C:<n>:<comando>`, una
  sola vez aunque haya sondeos simultáneos; los siguientes vuelven a `OK`.
- Resultado: el equipo responde en `POST /iclock/devicecmd`, un resultado por línea. El log lo
  muestra como `zkteco: resultado de comando` con `ID`, `Return` y `CMD` (el resto, redactado), y
  el `ID` cierra el comando de ese número.
- Bitácora: `GET /api/v1/attendance/devices/:deviceId/commands` lista cada comando con su
  `number` y su estado: `QUEUED` (en cola), `SENT` (entregado), `DONE` (el equipo respondió
  `Return=0`) o `FAILED` (otro código, en `returnCode`). `POST /iclock/devicecmd` solo se
  autentica con el serial y la red permitida, así que quien lo conozca desde esa red puede
  falsificar ese resultado (`ID=<n>&Return=0` u otro código) para cualquier comando `SENT` del
  equipo: la bitácora no es evidencia confiable de entrega frente a quien esté en la red del
  equipo (ver [ADR 0014](../adr/0014-comandos-salientes-con-serial-como-credencial.md) y
  [ADR 0015](../adr/0015-barrera-de-red-por-checador.md)).
  El texto del comando no se escribe en el log (puede traer un PIN o un nombre).

## Sincronización de colaboradores

Cada checador lleva a los colaboradores activos de su sede, con su RFC como PIN (plan 007).

- **Qué la dispara**: darle redes permitidas a un equipo que no tenía (`PUT …/networks`), cambiar
  su sede, los eventos de colaboradores (alta, cambio de sede, RFC asignado, baja) o el endpoint
  manual `POST /api/v1/attendance/devices/:deviceId/sync` (HOLDING_ADMIN). **Nunca** el registro
  solo: el orden es registrar → `PUT …/networks` → llegan los usuarios.
- Un equipo sin redes permitidas se omite (warn, ver la tabla de logs); el endpoint manual
  responde 422 `DEVICE_NETWORK_UNRESTRICTED`.
- Los colaboradores sin RFC no se envían: el endpoint los lista en `skipped` (`NO_RFC`).
- El API solo borra usuarios que él mismo puso (registro `attendance.device_users`): los que se
  crearon en el equipo a mano, como el "1" y el "2", no se tocan.
- El equipo recibe un comando por sondeo (~10 s): una sede de 100 personas tarda ~17 min.
- Cómo comprobarlo: la bitácora (`GET …/commands`) muestra cada comando en `DONE` o `FAILED`;
  los automáticos traen `queuedBy: null`.
- `DELETE USERINFO` sigue **pendiente de confirmar** en el equipo real hasta la verificación del
  plan 007.

## Qué buscar en el log

| Mensaje                                              | Nivel | Cuándo                                              |
| ---------------------------------------------------- | ----- | --------------------------------------------------- |
| `zkteco: contacto del dispositivo`                   | info  | handshake, resultado de comando, ruta desconocida   |
| `zkteco: contacto del dispositivo`                   | debug | consulta de comandos (cada ~10 s)                   |
| `zkteco: datos recibidos`                            | info  | cada envío: tabla, total y conteo por tipo          |
| `zkteco: registro`                                   | debug | cada registro interpretado y redactado              |
| `zkteco: marcaciones guardadas`                      | info  | tras un `ATTLOG`: recibidas, nuevas y duplicadas    |
| `zkteco: marcación rechazada`                        | warn  | línea `ATTLOG` con PIN o fecha inválidos            |
| `zkteco: dispositivo no autorizado`                  | warn  | SN no registrado o equipo inactivo                  |
| `zkteco: IP no permitida`                            | warn  | request desde una IP fuera de las redes del equipo  |
| `zkteco: redes del equipo actualizadas`              | info  | un administrador cambió las redes permitidas        |
| `zkteco: comando encolado`                           | info  | un administrador encoló un comando                  |
| `zkteco: comando entregado`                          | info  | el equipo recibió el comando en su consulta         |
| `zkteco: resultado de comando`                       | info  | respuesta del equipo en `devicecmd` (redactada)     |
| `zkteco: comando completado`                         | info  | la respuesta cerró el comando como `DONE`           |
| `zkteco: comando completado`                         | warn  | la respuesta cerró el comando como `FAILED`         |
| `zkteco: resultado sin comando`                      | warn  | respuesta con un `ID` que no es de ese equipo       |
| `zkteco: sincronización de checador`                 | info  | se sincronizó un equipo: encolados, bajas, omitidos |
| `zkteco: checador sin redes, sincronización omitida` | warn  | un equipo sin redes permitidas no recibió usuarios  |
| `zkteco: comando de sincronización inválido`         | warn  | el texto de un usuario no pasó la validación        |

Si aparece un contacto `kind: 'unknown'`, el firmware usó una ruta que la sonda no conoce:
anótala para el siguiente plan.
