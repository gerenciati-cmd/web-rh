# 0013 — Registro de equipos en base de datos como autenticación del dispositivo

- **Estado**: Aceptado
- **Fecha**: 2026-10-02

## Contexto

El ADR 0008 exigía, como autenticación de los equipos físicos, una allowlist de números de serie
en configuración (`ZKTECO_ALLOWED_SERIALS`). Con el plan `attendance-marcaciones/001` las
marcaciones se guardan y cada una necesita la zona horaria de su equipo para calcular el instante
UTC; además, dar de alta un checador no debería requerir editar el `.env` y reiniciar el API.

El ADR 0008 es inmutable; este lo reemplaza solo en lo que respecta a la autenticación del equipo.
El resto de su decisión (`deviceRouter` fuera de `/api/v1` y de los contratos, redacción de datos
personales, router sin lógica de negocio) sigue vigente.

## Decisión

- Un equipo se autentica si su número de serie (`SN`) está en el registro `attendance.devices` y
  está activo. Uno no registrado o inactivo recibe `403 ERROR: dispositivo no autorizado` y un
  warn `zkteco: dispositivo no autorizado`.
- Los equipos se registran con `POST /api/v1/attendance/devices` (permiso
  `attendance.devices:manage`), con serial, nombre y zona horaria IANA.
- La verificación la hacen los casos de uso del módulo (`RecordDeviceContact`, `RecordDevicePush`)
  contra el puerto `DeviceRepository`, no el router.
- `ZKTECO_ALLOWED_SERIALS` se elimina; si queda en un `.env`, se ignora.

## Alternativas consideradas

- **Mantener la allowlist en el env y la zona en otra variable**: dos fuentes que deben coincidir,
  y cada alta exige editar configuración y reiniciar.
- **Registro en BD más allowlist como segunda barrera**: duplica la fuente de verdad sin agregar
  seguridad real, porque ambas se basan en el mismo serial que el equipo manda en claro.

## Consecuencias

- Dar de alta un checador es una operación de la app, auditable y sin reinicio.
- Al desplegar, cada equipo debe registrarse antes de conectarse o será rechazado.
- El serial sigue siendo la única credencial del equipo (ADMS no ofrece otra). Señal para revisar:
  si se exponen los `/iclock` fuera de una red controlada, hace falta una barrera adicional
  (red, proxy con mTLS o similar).
