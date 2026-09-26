# 0003 — Arquitectura hexagonal + CQRS ligero

- **Estado**: Aceptado
- **Fecha**: 2026-09-25

## Contexto

Se requiere que la aplicación no dependa de la base de datos ni del framework, y que las reglas
de negocio (legales, en muchos casos) sean testeables de forma aislada. Además, es mayoritariamente listados y reportes que cruzan muchos datos.

## Decisión

- **Hexagonal** por módulo: `domain` (puro) ← `application` (casos de uso + puertos) ←
  `infrastructure` (adaptadores) · `http`.
- **CQRS ligero**: commands pasan por agregados + `XxxRepository` y devuelven `Result`; queries
  usan un puerto `XxxQueries` que devuelve DTOs sin construir agregados. Misma base de datos; sin
  buses ni event sourcing.

## Alternativas consideradas

- **Solo repositorios**: los repositorios crecen con métodos "para pantallas" o las lecturas
  cargan agregados completos (N consultas, sobrecarga).
- **CQRS completo / event sourcing**: complejidad no justificada hoy. Podría evaluarse para
  asistencia (marcaciones inmutables) en un ADR propio.

## Consecuencias

- Dominio y casos de uso se testean sin BD. Lecturas optimizables libremente.
- Dos puertos por módulo (más archivos). En mantenedores triviales una query puede usar el repositorio.
