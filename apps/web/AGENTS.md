<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Reglas del repo para apps/web

Lee primero el `AGENTS.md` de la raíz.

- Solo UI. **Sin lógica de negocio ni acceso a BD**: todo dato viene del API vía `@/lib/api`
  (`@rrhh/api-client`, tipado desde `@rrhh/contracts`). No escribas `fetch` a mano contra el API.
- Rutas en `src/app/` delgadas; componentes y hooks por dominio en `src/features/<modulo>/`.
- Páginas con datos vivos: `await connection()` (o leer cookies/headers) para evitar que se
  pre-rendericen en el build.
- Validación de formularios: reusar los schemas de `@rrhh/contracts` (misma regla que el backend).
