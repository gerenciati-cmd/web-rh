# 0016 — Jobs programados declarados por módulo

- **Estado**: Aceptado
- **Fecha**: 2026-10-14

## Contexto

Asistencia necesita cerrar jornadas sin que nadie lo pida: cada hora debe recalcular los últimos
días de cada colaborador para que las faltas aparezcan cuando la ventana del turno ya cerró
(plan `attendance-asistencia-diaria/003`). Hasta ahora la plataforma solo tenía jobs de una vez:
un caso de uso encola vía `JobQueue` y el worker ejecuta el `JobHandler` con ese nombre. No había
forma de declarar un job recurrente.

## Decisión

- Usamos los **job schedulers de BullMQ** (`Queue.upsertJobScheduler`) sobre la misma cola que los
  jobs de una vez.
- Cada módulo declara sus jobs recurrentes en `AppModule.schedules` como `ScheduledJob`
  (`name`, patrón cron y zona horaria IANA).
- El **worker** recorre los módulos al arrancar y hace `upsert` de cada uno con un id estable igual
  al nombre del job, así que reiniciar el worker no duplica nada. El proceso del API nunca programa.
- El handler de un job programado es un `JobHandler` común, registrado en `AppModule.jobs`.

## Alternativas consideradas

- node-cron dentro del proceso del API — corre una vez por réplica del API: con dos réplicas el
  cierre se ejecuta dos veces.
- Un cron externo que llame a un endpoint — otra pieza que desplegar y vigilar, y una ruta
  autenticada para máquinas que hoy no existe.

## Consecuencias

- Los jobs recurrentes solo corren si el worker está corriendo (en desarrollo,
  `pnpm --filter @rrhh/api dev:worker`).
- Quitar un `ScheduledJob` del código no lo borra de Valkey: hay que eliminarlo explícitamente con
  `removeJobScheduler(<nombre>)`.
- Si un job programado necesitara zona horaria por empresa o un calendario más rico que un cron,
  habría que revisar esta decisión.
