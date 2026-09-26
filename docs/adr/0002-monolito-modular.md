# 0002 — Monolito modula

- **Estado**: Aceptado
- **Fecha**: 2026-09-25

## Contexto

RRHH tiene datos muy acoplados: la nómina necesita en la misma operación contratos, asistencia,
ausencias, licencias y vacaciones. Equipo pequeño, un solo producto. Se replicará también el
sistema de asistencia, que podría tener carga alta (marcaciones desde relojes y móviles).

## Decisión

Un único deployable (`apps/api`) dividido en **módulos con fronteras estrictas**: schema de
Postgres propio, API pública en `index.ts`, sin FKs ni lecturas cruzadas, comunicación por
fachadas (vía puertos propios del consumidor) o eventos. Reglas verificadas con dependency-cruiser.
Mismo código con dos entrypoints: HTTP y worker.

## Alternativas consideradas

- **Microservicios desde el inicio**: transacciones distribuidas y consistencia eventual en el
  cálculo de sueldos, más infraestructura y observabilidad de la que el equipo puede sostener.
- **Monolito sin fronteras**: rápido al principio, pero termina en acoplamiento que impide
  extraer asistencia si lo necesita.

## Consecuencias

- Transacciones locales simples; un solo despliegue.
- Extraer un módulo (candidato: `attendance`) = reemplazar sus adaptadores entre módulos por
  clientes HTTP/colas. Señal para hacerlo: necesidad de escalar o desplegar por separado.
