# ZKTeco SenseFace 2A — sonda ADMS

Runbook de la sonda del módulo `attendance`
(plan `plans/attendance-sonda-zkteco/001-recepcion-adms-solo-log.md`, ADR 0008).

## Qué hace y qué no

El API atiende el protocolo push ADMS del equipo y **solo escribe en el log** lo que recibe:
handshake, marcaciones (`ATTLOG`), operaciones y usuarios (`OPERLOG`), biometría (`BIODATA`,
`BIOPHOTO`, `USERPIC`) y datos del equipo (`options`).

- No guarda nada en base de datos.
- No envía comandos al equipo: `getrequest` siempre responde `OK`.
- No asocia el PIN a un colaborador.
- No interpreta la hora. El equipo manda su hora local sin desfase; en Cancún es UTC−5 todo el año.
- Plantillas, fotos (`Tmp`, `Content`), nombres, claves y tarjetas **nunca** aparecen en el log:
  salen como `[redactado:<largo>]`.

## Equipo probado

SenseFace 2A, firmware `ZAM70-NF24HA-Ver3.3.12`, PushVersion `Ver 3.1.2S-20250616`.

## Configuración

1. En tu `.env` local del API, define `ZKTECO_ALLOWED_SERIALS` con el número de serie del equipo.
   Para varios, sepáralos por coma. Si queda vacío, se rechazan todos los equipos (403).
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

Usa un SN ficticio incluido en `ZKTECO_ALLOWED_SERIALS` (por ejemplo `TESTSN001`) y datos
sintéticos:

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
| `zkteco: dispositivo no autorizado` | warn  | SN fuera de la allowlist                          |

Si aparece un contacto `kind: 'unknown'`, el firmware usó una ruta que la sonda no conoce:
anótala para el siguiente plan.
