## Qué y por qué

<!-- Qué cambia y qué problema de negocio resuelve. -->

## Cómo se verificó

- [ ] `pnpm check` pasa
- [ ] Tests nuevos para el comportamiento agregado (camino feliz + errores)
- [ ] Probado manualmente (describe cómo):

## Checklist de arquitectura

- [ ] Reglas de negocio en `domain/`, no en routers/mappers/UI
- [ ] Escrituras por agregado + repositorio; lecturas por `XxxQueries` (CQRS ligero)
- [ ] Sin imports a internos de otros módulos (solo `index.ts`, solo desde `infrastructure/`)
- [ ] Tipos de request/response desde `@rrhh/contracts` (sin duplicar)
- [ ] Si cambió el esquema: migración NUEVA y SQL revisado (sin DROP inesperados)
- [ ] Si hubo una decisión de arquitectura: ADR en `docs/adr/`
