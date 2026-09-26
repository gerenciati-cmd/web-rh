# 0001 — Monorepo con pnpm workspaces + Turborepo

- **Estado**: Aceptado
- **Fecha**: 2026-09-25

## Contexto

Tres clientes del mismo dominio (API, web, mobile) comparten tipos, validaciones (RUT, montos) y
contratos HTTP. Equipo pequeño; se necesita que un cambio de contrato rompa el build de todos los
consumidores en el mismo PR.

## Decisión

Un único repositorio con pnpm workspaces (`apps/*`, `packages/*`) y Turborepo para orquestar
tareas con caché. Paquetes internos publicados como **TypeScript fuente** (sin build propio);
cada consumidor los compila (tsup en API, `transpilePackages` en Next, Metro en Expo).
Versiones compartidas en `catalog:` de `pnpm-workspace.yaml`.

## Alternativas consideradas

- **Polyrepo**: obliga a versionar y publicar paquetes internos; los cambios de contrato se
  desincronizan entre repos.
- **Nx**: más potente pero más opinado y pesado para el tamaño actual.

## Consecuencias

- Un PR puede cambiar contrato + API + web + mobile de forma atómica.
- `pnpm check` valida todo el sistema; Turborepo cachea lo que no cambió.
- Las imágenes Docker usan `turbo prune` para no arrastrar el monorepo completo.
