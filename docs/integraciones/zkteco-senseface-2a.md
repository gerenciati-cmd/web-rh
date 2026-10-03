# ZKTeco SenseFace 2A — sonda ADMS

Runbook de la sonda del módulo `attendance`
(plan `plans/attendance-sonda-zkteco/001-recepcion-adms-solo-log.md`, ADR 0008; autenticación por registro en BD:
ADR 0013).

## Qué hace y qué no

El API atiende el protocolo push ADMS del equipo: handshake, marcaciones (`ATTLOG`),
operaciones y usuarios (`OPERLOG`), biometría (`BIODATA`, `BIOPHOTO`, `USERPIC`) y datos del
equipo (`options`).

- Solo atiende equipos **registrados** (`POST /api/v1/attendance/devices`, solo HOLDING_ADMIN) y
  activos; cualquier otro recibe 403.
- Las marcaciones `ATTLOG` se guardan sin duplicados (el equipo reenvía su historial en cada
  handshake), con la hora local tal como llegó y su instante UTC, calculado con la zona horaria
  del equipo registrado.
- Las demás tablas (`OPERLOG`, `BIODATA`, `options`…) siguen **solo en el log**.
- El estado de cada equipo (último contacto, última marcación) se consulta con
  `GET /api/v1/attendance/devices`; las marcaciones, con `GET /api/v1/attendance/punches`
  (HOLDING_ADMIN todas; RRHH solo las de colaboradores de sus empresas, ver "Atribución").
- No envía comandos al equipo: `getrequest` siempre responde `OK`.
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
   actualiza también la zona horaria del equipo.

2. Para ver cada registro, usa `LOG_LEVEL=debug`. En `info` solo se ve el resumen por envío.
3. Levanta el API (`pnpm dev:api`). Escucha en `PORT` (3001 por defecto) en todas las interfaces.
4. El equipo debe poder llegar a tu máquina: abre ese puerto TCP de entrada en el firewall,
   idealmente solo para la IP del equipo.
5. En el equipo, menú de comunicación → "Modo servidor ADMS":
   - "Habilitar nombre de dominio": apagado. Al apagarlo aparece "Puerto del servidor".
   - "Dirección del servidor": la IP de tu máquina en la LAN.
   - "Puerto del servidor": el valor de `PORT`.
   - "Habilitar servidor proxy": apagado.

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
cómo responde. **El formato no está confirmado**: la familia `DATA UPDATE|QUERY|DELETE USERINFO`
es una hipótesis tomada de la literatura del protocolo PUSH de ZKTeco.

- Encolar (HOLDING_ADMIN): `POST /api/v1/attendance/devices/:deviceId/commands` con
  `{ "command": "DATA UPDATE USERINFO …" }`. Solo se aceptan comandos `USERINFO` (con prefijo
  opcional `C:<n>:`); cualquier otro texto responde 400.
- Entrega: el siguiente `GET /iclock/getrequest` de ese equipo responde exactamente el texto
  encolado, una sola vez; los siguientes vuelven a `OK`.
- Resultado: el equipo responde en `POST /iclock/devicecmd`; el log lo muestra como
  `zkteco: resultado de comando` con los campos `ID`, `Return` y `CMD` (el resto, redactado).
- Bitácora: `GET /api/v1/attendance/devices/:deviceId/commands` lista cada comando con su estado
  (`QUEUED`/`SENT`) y cuándo se envió. El texto del comando no se escribe en el log (puede traer
  un PIN o un nombre).

## Qué buscar en el log

| Mensaje                             | Nivel | Cuándo                                            |
| ----------------------------------- | ----- | ------------------------------------------------- |
| `zkteco: contacto del dispositivo`  | info  | handshake, resultado de comando, ruta desconocida |
| `zkteco: contacto del dispositivo`  | debug | consulta de comandos (cada ~10 s)                 |
| `zkteco: datos recibidos`           | info  | cada envío: tabla, total y conteo por tipo        |
| `zkteco: registro`                  | debug | cada registro interpretado y redactado            |
| `zkteco: marcaciones guardadas`     | info  | tras un `ATTLOG`: recibidas, nuevas y duplicadas  |
| `zkteco: marcación rechazada`       | warn  | línea `ATTLOG` con PIN o fecha inválidos          |
| `zkteco: dispositivo no autorizado` | warn  | SN no registrado o equipo inactivo                |
| `zkteco: comando encolado`          | info  | un administrador encoló un comando                |
| `zkteco: comando entregado`         | info  | el equipo recibió el comando en su consulta       |
| `zkteco: resultado de comando`      | info  | respuesta del equipo en `devicecmd` (redactada)   |

Si aparece un contacto `kind: 'unknown'`, el firmware usó una ruta que la sonda no conoce:
anótala para el siguiente plan.
