# 0004 — Contratos HTTP compartidos con Zod

- **Estado**: Aceptado
- **Fecha**: 2026-09-25

## Contexto

Web y mobile consumen el mismo API. Mantener tipos de request/response a mano en cada cliente
produce desalineaciones silenciosas.

## Decisión

Cada endpoint se declara una vez en `@rrhh/contracts` con `defineRoute({ method, path, params,
query, body, response })` usando Zod 4. El API lo usa para validar (`bindRoute`) y, fuera de
producción, para verificar sus respuestas. `@rrhh/api-client` deriva automáticamente un cliente
tipado del catálogo `apiRoutes` y valida las respuestas recibidas.

## Alternativas consideradas

- **ts-rest**: al momento de decidir no soportaba Zod 4.
- **OpenAPI + generación de código**: paso de build extra y tipos generados más difíciles de leer.
  Se puede generar OpenAPI desde los mismos schemas cuando haya consumidores externos.
- **tRPC**: acopla el transporte y es menos natural para clientes no TypeScript o integraciones.

## Consecuencias

- Cambiar un contrato rompe el typecheck de todos los consumidores en el mismo PR.
- Las validaciones compartidas (RUT) usan funciones de `@rrhh/domain` dentro de los schemas.
