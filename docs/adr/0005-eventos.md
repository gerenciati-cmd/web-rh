# 0005 — Eventos de dominio in-process; outbox cuando haga falta

- **Estado**: Aceptado
- **Fecha**: 2026-09-25

## Contexto

Los módulos deben reaccionar a hechos de otros (p. ej. `employees.employee.hired` → crear saldo
de vacaciones) sin importarse directamente.

## Decisión

Los agregados registran eventos (`record`); el caso de uso los publica tras persistir con el
puerto `EventBus`. Implementación inicial: `InMemoryEventBus` (mismo proceso, errores de
handlers aislados y logueados).

## Alternativas consideradas

- **Transactional Outbox desde el inicio**: más robusto pero más infraestructura antes de tener
  un solo consumidor crítico.
- **Llamadas directas entre módulos**: acoplamiento temporal y de despliegue.

## Consecuencias

- Si el proceso cae entre commit y publish, el evento se pierde. Aceptable para efectos
  secundarios no críticos.
- **Señal para migrar a outbox** (misma interfaz `EventBus`): el primer evento cuya pérdida
  cause un error de negocio (nómina, saldos legales, notificaciones obligatorias).
