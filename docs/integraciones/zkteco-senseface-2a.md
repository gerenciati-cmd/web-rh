# ZKTeco SenseFace 2A — sonda ADMS

Runbook de la sonda del módulo `attendance`
(plan `plans/attendance-sonda-zkteco/001-recepcion-adms-solo-log.md`, ADR 0008).

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
  (solo HOLDING_ADMIN).
- No envía comandos al equipo: `getrequest` siempre responde `OK`.
- No asocia el PIN a un colaborador.
- Plantillas, fotos (`Tmp`, `Content`), nombres, claves y tarjetas **nunca** aparecen en el log:
  salen como `[redactado:<largo>]`.

## Equipo probado

SenseFace 2A, firmware `ZAM70-NF24HA-Ver3.3.12`, PushVersion `Ver 3.1.2S-20250616`.

## Configuración

1. Registra el equipo como HOLDING_ADMIN con su número de serie y su zona horaria IANA (la hora
   local que manda el equipo se interpreta en esa zona; Cancún es `America/Cancun`):

   ```sh
   curl -X POST -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" \
     -d '{"serialNumber":"TESTSN001","name":"Entrada principal","timeZone":"America/Cancun"}' \
     http://localhost:3001/api/v1/attendance/devices
   ```

   Un serial ya registrado responde 409; un equipo no registrado recibe 403 en `/iclock`.

2. Para ver cada registro, usa `LOG_LEVEL=debug`. En `info` solo se ve el resumen por envío.
3. Levanta el API (`pnpm dev:api`). Escucha en `PORT` (3001 por defecto) en todas las interfaces.
4. El equipo debe poder llegar a tu máquina: abre ese puerto TCP de entrada en el firewall,
   idealmente solo para la IP del equipo.
5. En el equipo, menú de comunicación → "Modo servidor ADMS":
   - "Habilitar nombre de dominio": apagado. Al apagarlo aparece "Puerto del servidor".
   - "Dirección del servidor": la IP de tu máquina en la LAN.
   - "Puerto del servidor": el valor de `PORT`.
   - "Habilitar servidor proxy": apagado.

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

Si aparece un contacto `kind: 'unknown'`, el firmware usó una ruta que la sonda no conoce:
anótala para el siguiente plan.
