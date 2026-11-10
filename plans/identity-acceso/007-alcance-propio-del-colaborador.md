---
status: done
module: identity
min_implementer: mid
depends_on: ['003']
---

# 007 — Own-data scope for the colaborador

## Context

A signed-in colaborador can do nothing beyond `/auth/me` today. Three facts cause this:

- **The role grants nothing.** `EMPLOYEE` has `scope: 'SELF', permissions: []` and is described
  as inert because "sus alcances (equipo, propio) aún no se aplican en ninguna consulta"
  (`apps/api/src/modules/identity/domain/role-catalog.ts:9-13, 44`). `grantsFor` expands roles
  to `{ permission, companyId }` grants (`role-catalog.ts:48-54`), so EMPLOYEE yields zero grants.
- **The role does carry the colaborador's company.** It is granted only at activation, through
  `RoleAssignment.grantSelf` with the colaborador's company
  (`apps/api/src/modules/identity/domain/role-assignment.ts:75-93`;
  `application/commands/activate-account.command.ts:90-98`).
- **The `Actor` does not know who the colaborador is.** It is `{ userId, sessionId, grants }`
  (`apps/api/src/shared/application/actor.ts:9-13`). `SessionAuthenticator` already loads the
  `User` (`session-authenticator.ts:31`), whose props carry `employeeId: string | null`
  (`domain/user.ts:13`), but does not put it on the actor (`session-authenticator.ts:46`).

**Access control.**

- Contracts declare access as public, authenticated or permission, with an optional
  `companyParam` (`packages/contracts/src/http.ts:9-26`).
- `authorize` enforces it before validating the query and body
  (`apps/api/src/http/bind-route.ts:59, 81-98`).
- Permission names live in `packages/domain/src/identity/access.ts:6-28`.

**Chosen approach** (identity-acceso decision 6: atomic permissions; decision 22: "self-service
endpoints come with their modules"):

1. The actor carries `employeeId`.
2. EMPLOYEE gets its first own-data permission, `attendance.workdays:read-own`. Its grant keeps
   the colaborador's company as `companyId`, as `grantSelf` already sets it.
3. "Own" routes declare `requires('attendance.workdays:read-own')` with no `companyParam`, and
   resolve the colaborador **only from `actor.employeeId`**, never from the path. So no one can
   ask for another person's data.

**Alternative rejected:** a new `self` access kind in contracts. It adds a fourth enforcement
path, and it cannot be switched off per data type the way an atomic permission can.

`HOLDING_ADMIN` has every permission (`role-catalog.ts:15`), so it gains `read-own` too. With
`employeeId: null` the consuming use case answers "account not linked"; attendance plan 005 owns
that error.

The consumer is `attendance-asistencia-diaria/005`, the "my jornadas" endpoints.

## Out of scope

- Any attendance endpoint, use case or error (attendance-asistencia-diaria/005).
- DIRECT_MANAGER and the TEAM scope.
- Other own-data permissions (vacations, profile, password change); each comes with its module.
- Changing `/auth/me` or `SessionUser`.
- Making EMPLOYEE assignable over HTTP.

## Dependencies

- **identity-acceso/003 (`done`):**
  - activation links `User.employeeId` and grants EMPLOYEE with the colaborador's company through
    `RoleAssignment.grantSelf`;
  - `ActivateAccount` is registered in the container (used by the test helper in step 5).

## Steps

1. **New permission name**
   - Files: `packages/domain/src/identity/access.ts` (modify)
   - Do: add `'attendance.workdays:read-own'` to `PERMISSIONS`, right after
     `'attendance.workdays:recalculate'`. Add a Spanish comment saying it covers only the
     caller's own jornadas, resolved from the actor and never from the path.
   - Observable result: the `Permission` type includes it, and `pnpm --filter @rrhh/domain test`
     passes.

2. **EMPLOYEE grants own jornadas**
   - Files: `apps/api/src/modules/identity/domain/role-catalog.ts` (modify)
   - Do:
     - Set `EMPLOYEE: { scope: 'SELF', permissions: ['attendance.workdays:read-own'], assignable: false }`.
     - Rewrite the docblock at lines 9-13: DIRECT_MANAGER is still inert. EMPLOYEE now grants
       own-data permissions, which routes resolve from `actor.employeeId` (decision 32 of the
       README). It is still granted only at activation.
     - Keep the comment at line 43.
   - Observable result: `grantsFor([{ role: 'EMPLOYEE', companyId: 'c1' }])` returns
     `[{ permission: 'attendance.workdays:read-own', companyId: 'c1' }]`.

3. **Actor carries the linked colaborador**
   - Files: `apps/api/src/shared/application/actor.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.ts` (modify)
   - Do:
     - Add `employeeId: string | null;` to `Actor`, with a Spanish docblock: it is the
       colaborador linked to the user, `null` for staff without a ficha, and own-data routes
       read the colaborador only from here.
     - In `authenticate`, return `{ userId: user.id, sessionId: session.id, employeeId: user.snapshot.employeeId, grants }`.
   - Observable result: typecheck fails only in the four test files of step 4.

4. **Keep existing tests compiling** (mechanical change, no behavior change)
   - Files: `apps/api/src/shared/application/actor.test.ts` (modify), `apps/api/src/modules/organization/application/queries/list-companies.query.test.ts` (modify), `apps/api/src/modules/attendance/application/queries/list-punches.query.test.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify)
   - Do:
     - In each `actorWith(...)` helper (`actor.test.ts:8`, `list-companies.query.test.ts:24`,
       `list-punches.query.test.ts:20`), add `employeeId: null` to the returned actor.
     - In `session-authenticator.test.ts:117, 187`, add `employeeId: null` to the expected actor.
       The users there are registered without a colaborador.
   - Observable result: `pnpm --filter @rrhh/api typecheck` and `test` pass.

5. **Test helper: sign in as a linked colaborador**
   - Files: `apps/api/tests/test-app.ts` (modify, by the tester)
   - Do: add `signInAsEmployee(container, { companyId, employeeId }): Promise<string>`.
     - It must go through the real flow: `inviteEmployee` (registered in the cradle, `apps/api/src/modules/identity/identity.module.ts:162`)
       for that employee, then `activateAccount` with the invitation token, then `logIn` with
       `client: 'mobile'`. It returns the bearer token.
     - Imitate `signInAs` (`test-app.ts:225-259`).
     - The tester reads `apps/api/tests/invitations.test.ts` for how the invitation token is
       obtained in tests.
   - Observable result: available to the tests of this plan and of attendance 005.

## Acceptance criteria

- [ ] `pnpm check` passes, including `arch:check`.
- [ ] A colaborador activated from an invitation logs in. Their requests run with
      `actor.employeeId` equal to their colaborador id, and with the grant
      `attendance.workdays:read-own` on their company.
- [ ] HR and HOLDING_ADMIN sessions keep exactly their previous access: every existing http test
      passes unchanged, apart from the mechanical `employeeId: null`.
- [ ] A colaborador's request to any staff route (for example
      `GET /companies/:companyId/employees`) still returns 403.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                     |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `grantsFor` for EMPLOYEE yields `read-own` with the assignment's company; HOLDING_ADMIN includes it; HR does not                          |
| application | yes     | `SessionAuthenticator` puts `employeeId` on the actor for a linked user and `null` for an unlinked one                                    |
| contract    | no      | No route change                                                                                                                           |
| http        | yes     | A colaborador signed in through `signInAsEmployee` gets 403 on staff routes (`employees`, `attendance/.../workdays` of their own company) |
| integration | no      | No persistence change (`employeeId` is already stored)                                                                                    |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                               |

## Deviations

- Step 3/4 (cosmetic, fixed forward): the plan said typecheck would fail only in four test files, but
  `apps/api/prisma/seed.ts:29` also builds an `Actor`. Added `employeeId: null` there.
- Step 4 (cosmetic, fixed forward): `apps/api/src/modules/identity/domain/role-catalog.test.ts`
  asserted EMPLOYEE was inert and failed after step 2. Updated those two assertions minimally and
  added a `grantsFor` EMPLOYEE case; the tester can extend.
- Step 5 (`apps/api/tests/test-app.ts`, `signInAsEmployee`) is the tester's, not done here.
- `pnpm plans:scope` also lists pre-existing untracked/modified files from other plans
  (attendance 005, mobile 003, `apps/mobile/.gitignore`, `docs/referencia/`) as out of scope; not mine.

## Test coverage

Baseline `pnpm check`: verde antes de escribir tests. Paso 5 hecho: `signInAsEmployee` en
`apps/api/tests/test-app.ts` (invitación -> activación con el token del correo encolado -> login móvil).

| Comportamiento                                                | Fuente                                 | Capa        | Test                                                                      | Estado    |
| ------------------------------------------------------------- | -------------------------------------- | ----------- | ------------------------------------------------------------------------- | --------- |
| EMPLOYEE concede read-own con la empresa de la asignación     | `role-catalog.ts:45`                   | domain      | `role-catalog.test.ts › EMPLOYEE concede read-own atado a la empresa…`    | CONFIRMED |
| Catálogo EMPLOYEE (permisos, no asignable)                    | `role-catalog.ts:45`                   | domain      | `role-catalog.test.ts › DIRECT_MANAGER es inerte y EMPLOYEE solo…`        | CONFIRMED |
| HOLDING_ADMIN incluye read-own (companyId null)               | `role-catalog.ts:16`                   | domain      | `role-catalog.test.ts › HOLDING_ADMIN incluye read-own…`                  | CONFIRMED |
| HR no recibe read-own                                         | `role-catalog.ts`                      | domain      | `role-catalog.test.ts › HR no recibe read-own`                            | CONFIRMED |
| Actor lleva `employeeId` de usuario vinculado; `null` si no   | `session-authenticator.ts:46`          | application | `session-authenticator.test.ts › usuario vinculado…` y los dos existentes | CONFIRMED |
| Colaborador con EMPLOYEE: grant read-own en su empresa + id   | `session-authenticator.ts:42-49`       | application | `session-authenticator.test.ts › colaborador con rol EMPLOYEE…`           | CONFIRMED |
| Sesión por flujo real: `employeeId` y grant read-own          | `test-app.ts` `signInAsEmployee`       | http        | `own-scope.test.ts › signInAsEmployee: el actor lleva…`                   | CONFIRMED |
| Colaborador: 403 en lista de colaboradores de su empresa      | `employee` contract (`employees:read`) | http        | `own-scope.test.ts › …lista de colaboradores…`                            | CONFIRMED |
| Colaborador: 403 en jornadas de su empresa (ruta de personal) | `attendance-workdays.test.ts:98` ruta  | http        | `own-scope.test.ts › …jornadas de su propia empresa…`                     | CONFIRMED |
| Colaborador: 403 al invitar                                   | ruta de invitaciones                   | http        | `own-scope.test.ts › …no puede invitar…`                                  | CONFIRMED |

Capas contract, integration y e2e: no aplican (según el plan). Sin GAP ni NOT CONFIRMED.

## Review findings

Reviewer, 2026-11-10. Diff: `git diff origin/main` (uncommitted working tree on
`feat/attendance-mis-jornadas`). Files from other plans (attendance 005, mobile 003, their
READMEs, `apps/mobile/.gitignore`, `docs/referencia/`) are excluded per the dispatch.

### Checklist: 13/13 (3 not applicable)

- [x] `pnpm plans:scope … --base origin/main`: exits 1 only because of the other plans' files
      (excluded) plus `apps/api/prisma/seed.ts` and `role-catalog.test.ts` (both recorded in
      Deviations) and `apps/api/tests/own-scope.test.ts` (the tester's new test file). The hot file
      `apps/api/tests/test-app.ts` changes only by appending: one new import and the new
      `signInAsEmployee` at the end. No existing line is modified.
- [x] `pnpm check`: green (format, typecheck/lint/test in 19/19 turbo tasks, including
      `tests/own-scope.test.ts` with 4 tests; arch, plans:lint, harness, quality).
- [x] Integration: not applicable. No `infrastructure/` or schema change.
- [x] Business rules in `domain/`: the role → permission mapping stays in `role-catalog.ts`.
      `SessionAuthenticator` only copies `employeeId` across.
- [x] CQRS-lite: not affected. No command, query or repository changed.
- [x] Contracts: no route change. `Permission` comes from `@rrhh/domain`, where `PERMISSIONS`
      lives.
- [x] Expected errors: not affected. Access denial is still the existing `PermissionDeniedError`.
- [x] Money/dates/ids: not applicable.
- [x] Schema/migration: not applicable. `employeeId` is already persisted.
- [x] DI: no new registrations. `tests/container.test.ts` is green.
- [x] No secrets or real personal data. The fixtures use made-up names and the standard test
      RFC/CURP.
- [x] Deviations are honest. Spot-checked: `apps/api/prisma/seed.ts:32` does add
      `employeeId: null` to `seedActor`, and the `role-catalog.test.ts` changes match the
      description.
- [x] Docs: README decision 32 and the plans table record the change. The ADR 0012 wording is
      covered under Info below.

### Findings

No Critical, High or Medium findings.

**Low / nit (non-blocking, test-only)**

- `apps/api/tests/own-scope.test.ts`, last `it`: the title says
  `'el colaborador no puede invitar ni listar empresas con permiso de personal'`, but the test
  only checks the invitation POST. It never calls `GET /companies`. The Test coverage table only
  claims "403 al invitar", so the evidence is still honest. If someone reads the title as proof
  that the colaborador cannot list companies, they are misled. Fix: trim the title, or add
  `as(employeeToken).get('/companies').expect(403)` (I checked the code path: `organization.companies:read`
  with no `companyParam`, and EMPLOYEE has no grant for it, so it would return 403). This is the
  tester's call and does not block verify.

**Info (no action required)**

- `docs/adr/0012-autorizacion-declarada-en-contratos.md:31` still says "`DIRECT_MANAGER` y
  `EMPLOYEE` existen pero son inertes". ADRs are immutable (`docs/adr/README.md:3`) and the line
  describes the state "hoy" at the time it was accepted. The new SELF behavior is recorded in
  identity-acceso README decision 32 and in the `role-catalog.ts` docblock, so nothing is stale
  outside the ADR. If the user wants ADRs to point forward, a later ADR or registry note could
  reference decision 32. That decision is the user's, not this plan's.
- I traced the bug hunt and it is clean:
  - **Authorization.** `authorize` (`apps/api/src/http/bind-route.ts:81-98`) with a `companyParam`
    requires a grant for that exact permission, and EMPLOYEE only holds `read-own`. So every staff
    route stays 403 even inside the colaborador's own company. The 3 http tests confirm this.
  - **Existing actors.** `HOLDING_ADMIN` gains `read-own` with `companyId: null`. HR does not gain
    it. Nothing else enumerates grants: `hasPermission` and `companiesWith` always filter by
    permission, so existing actors' access is unchanged.
  - **Spoofing.** `employeeId` comes only from the persisted `User`
    (`session-authenticator.ts:49`), not from any request input, so a client cannot spoof it.
  - **Later consumer.** The `employeeId: null` path for a HOLDING_ADMIN on own-data routes is
    assigned to attendance 005, as the plan states.

All checklist items passed and no finding requires a product code change. Status moved to `verify`.

## Verification

Verifier (inline, sesión principal), 2026-11-10. Resultado: **PASS**.

- `pnpm check`: verde completo (api 1427 tests + 5 skipped, contracts 389, domain 98, mobile 78;
  arch, plans:lint, harness, quality). Integración: no aplica (sin cambio de persistencia).
- App corriendo: API `apps/api` (`pnpm dev`, puerto 3000) + worker (`pnpm dev:worker`) sobre la
  base de desarrollo, Mailpit en `localhost:8025`.
- Cuenta de colaborador por el flujo real:
  - `InviteEmployee` ejecutado con el contenedor real (script temporal fuera del repo; la
    contraseña de admin vive en `.env` y no se lee) para la colaboradora sembrada
    `ana.rojas@example.com`, `invitedBy` = usuario `admin@example.com`;
  - el worker envió el correo; enlace `/activar?token=…` leído de Mailpit;
  - `POST /auth/activate` → 204; `POST /auth/login` con `client: 'mobile'` → 200 con token.
- Criterios de aceptación:
  - [x] `pnpm check` pasa, incluido `arch:check`.
  - [x] La colaboradora activada inicia sesión; `GET /auth/me` → 200 con su `employeeId`. Que el
        actor lleve `employeeId` y el grant `read-own` en su empresa no es observable por HTTP
        hasta attendance 005; lo cubre `own-scope.test.ts` (flujo real en contenedor).
  - [x] Accesos de RRHH y HOLDING_ADMIN sin cambio: la suite http existente pasa sin cambios salvo
        el `employeeId: null` mecánico.
  - [x] Rutas de personal → 403 con su token: `GET /companies/:id/employees`,
        `GET /companies/:id/attendance/employees/:employeeId/workdays` (su propia ficha y empresa)
        y `GET /companies`.
- Nota: el nit Low de la revisión (título del último test de `own-scope.test.ts`) queda sin
  cambiar; `GET /companies` → 403 se comprobó aquí en la app.
- La cuenta de Ana queda activa en la base de desarrollo para verificar attendance 005 y mobile 003.
