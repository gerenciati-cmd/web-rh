# identity-acceso — Login, sesiones y roles

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status identity-acceso`. -->

## Goal

Nobody can use the platform anonymously. Every person with access (holding admins, RRHH, jefes,
colaboradores) signs in with email + password, gets a revocable session (web cookie / mobile
token), and every API call runs as a known `Actor` whose roles decide what they may see and do,
scoped to the holding, one or more empresas, their team, or themselves. Today every `/api/v1`
endpoint is open (`apps/api/src/http/app.ts:43-47` mounts module routers with no auth step).

## Plans

| Plan | Title                                           | Depends on | Purpose                                                                                                                  |
| ---- | ----------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 001  | Módulo identity: usuarios, login y sesiones     | —          | `User`, argon2id, `identity.sessions`, login/logout/me, request `Actor`, throttle, ADR 0011                              |
| 002  | Roles, permisos y protección de endpoints (TBD) | 001        | Role catalog, `(user, role, scope)` assignments, route permissions, row filtering, 403                                   |
| 003  | Invitación, activación y reseteo (TBD)          | 002        | RRHH invites a colaborador (links `User.employeeId`), set/reset password by email, revoke on baja                        |
| 004  | Login en web y mobile (TBD, deferred)           | 001        | Login screens, cookie handling in Next, `expo-secure-store` token in mobile — not before a UI design exists (decision 9) |

## Dependency notes

- 002 needs the `Actor` that 001 propagates to route handlers.
- 003 needs 002: inviting users and assigning roles must itself be permission-protected; until
  then users are created only by the dev seed (plan 001), never over HTTP.
- 004 only needs 001's endpoints, but is deferred until there is a UI design (decision 9).

## Decisions with the user

1. (2026-09-29) Identity comes before any new business module (leave, payroll, documents): all
   of them need to know who is calling.
2. (2026-09-29) `User` is separate from `Employee`, in its own `identity` module. A user may link
   to a colaborador by `employeeId` (optional, by id, no FK — ADR 0010). Not every user is a
   colaborador (external admin/accountant) and not every colaborador has access.
3. (2026-09-29) Login identifier = email + password, like Buk. The email may be personal; it
   belongs to the `User`, distinct from the colaborador's corporate email in their ficha.
4. (2026-09-29) Sessions are opaque, server-side, stored in a **Postgres table**
   (`identity.sessions`), holding only the hash of the token. Web: httpOnly cookie. Mobile:
   `Authorization: Bearer`. JWT access + refresh tokens discarded (see below).
5. (2026-09-29) Session lifetimes, **development values, to be revisited before production**:
   web 30 min idle / 12 h absolute; mobile 30 days absolute. Configurable by env var.
6. (2026-09-29) Role catalog fixed in code, four roles: **Admin holding** (scope: holding;
   everything, incl. users and roles), **RRHH** (scope: empresa; everything about colaboradores
   **including sensitive data and salaries**), **Jefe directo** (scope: team; sees their team
   without sensitive data, approves requests), **Colaborador** (scope: self; self-service).
   Permissions are atomic (`employees:read`, `payroll:read`, …) so a separate Nómina role or UI-
   configurable roles can be added later without rewriting enforcement.
7. (2026-09-29) Puesto (job position) ≠ access role. The position never grants permissions.
8. (2026-09-29) Out of this initiative: ficha ampliada of the colaborador, the `documents` module
   (expediente), and at-rest encryption of PII (CURP, RFC, NSS, bank data) with blind indexes —
   each is its own initiative.
9. (2026-09-29) API only for now: no web or mobile screens until there is a UI design. Plans
   001-003 touch only `apps/api` and `packages/*`; plan 004 waits.

## Delivered

## Considered and discarded

- **JWT access + refresh tokens** (what `docs/architecture.md:131` anticipated): a stolen or
  terminated user's access token stays valid until expiry and role changes lag until refresh;
  fixing that needs a server-side denylist, i.e. a session store anyway. JWT pays off when many
  services validate tokens without a shared store; this is a monolith with one database.
- **Sessions in Valkey**: fast, but volatile and not auditable; listing a user's devices and
  auditing logins want durable rows. A cache can be added later if the per-request lookup shows up
  in latency (decision 4).
- **Separate Nómina role now**: the user chose RRHH sees everything (decision 6); atomic
  permissions keep the split cheap later.
