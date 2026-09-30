# 0012 — Autorización declarada en los contratos

- **Estado**: Aceptado
- **Fecha**: 2026-09-30

## Contexto

Tras el plan 001 de `plans/identity-acceso/` cada petición tiene un `Actor` (ADR 0011), pero las
rutas de negocio seguían abiertas a cualquiera: nada decía quién puede llamar a cada endpoint ni
sobre qué empresas. Con varias empresas en el holding hace falta que el permiso dependa del rol y
del alcance (todo el holding o una empresa), que una ruta sin regla explícita sea un error y no un
agujero, y que el mismo dato alimente la documentación OpenAPI.

## Decisión

- **El acceso se declara por ruta en `packages/contracts`**: `RouteDefinition.access` es
  obligatorio y vale `public`, `authenticated` o `permission` (con un permiso atómico y, si aplica,
  `companyParam`: el parámetro de path cuya empresa debe estar en el alcance del actor). Negado por
  defecto: omitirlo es un error de tipos.
- **`bindRoute` lo hace cumplir una sola vez**, después de validar y antes del handler: sin actor
  → 401 `AUTHENTICATION_REQUIRED`; sin permiso o fuera de alcance → 403 `FORBIDDEN`. Es un error de
  adaptador (`PermissionDeniedError`), como el 401. El 403 se da aunque la empresa no exista, para
  que quien no tiene alcance no pueda sondear cuáles existen.
- **Catálogo fijo de roles** (`HOLDING_ADMIN`, `HR`, `DIRECT_MANAGER`, `EMPLOYEE`) con permisos
  atómicos; el vocabulario vive en `@rrhh/domain` y el mapeo rol → permisos en
  `identity/domain/role-catalog.ts`. Las asignaciones `(usuario, rol, alcance)` se guardan en
  `identity.role_assignments`, se revocan sin borrarse y se administran por HTTP. Solo los alcances
  holding y empresa se aplican hoy; `DIRECT_MANAGER` y `EMPLOYEE` existen pero son inertes.
- **Los permisos se expanden una vez por petición**: `SessionAuthenticator` lee las asignaciones
  activas y las convierte en `grants` del `Actor`. Revocar un rol surte efecto en la siguiente
  petición del usuario.
- **El filtrado de filas lo hace el caso de uso dueño de la lectura** (`ListCompanies` recibe el
  actor y pide solo las empresas visibles), no el router.
- OpenAPI refleja lo mismo: `security: []` en rutas públicas, `x-permission` y `x-company-param`
  en las demás, y el 403 en la respuesta de error.

## Alternativas consideradas

- Comprobaciones escritas a mano en cada handler o caso de uso — se olvidan sin que nada falle, y
  la documentación tendría que repetirlas.
- Permisos dentro de un JWT — no se pueden revocar antes de que expire el token; ADR 0011 ya
  eligió sesiones opacas justamente para poder revocar.

## Consecuencias

- Una ruta nueva no compila sin declarar su acceso, y el cambio de permisos no toca los handlers.
- Cada petición autenticada hace una lectura extra (asignaciones activas); es una consulta
  indexada por `(user_id, revoked_at)`.
- Quedan pendientes los alcances de equipo y propio, y el filtrado por campo. Dos administradores
  que se revocan mutuamente a la vez pueden dejar el holding sin administrador (riesgo residual
  aceptado). Revisar si el costo de la lectura por petición o el número de roles lo justifica.
