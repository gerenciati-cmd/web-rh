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

| Plan | Title                                       | Depends on | Purpose                                                                                                                  |
| ---- | ------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| 001  | Módulo identity: usuarios, login y sesiones | —          | `User`, argon2id, `identity.sessions`, login/logout/me, request `Actor`, throttle, ADR 0011                              |
| 002  | Roles, permisos y protección de endpoints   | 001        | Role catalog, `(user, role, scope)` assignments, route access in contracts, row filtering, 403, ADR 0012                 |
| 003  | Invitación, activación y baja de accesos    | 002        | Invitations (RRHH/Admin), activation links `User.employeeId` + EMPLOYEE role, disable on termination, email queue        |
| 004  | Login en web y mobile (TBD, deferred)       | 001        | Login screens, cookie handling in Next, `expo-secure-store` token in mobile — not before a UI design exists (decision 9) |
| 005  | Reseteo de contraseña                       | 003        | "Forgot password" (1 h link), staff-forced reset by email, all sessions closed on reset; fixes hallazgo L3               |

## Dependency notes

- 002 needs the `Actor` that 001 propagates to route handlers.
- 003 needs 002: inviting users and assigning roles must itself be permission-protected; until
  then users are created only by the dev seed (plan 001), never over HTTP.
- 004 only needs 001's endpoints, but is deferred until there is a UI design (decision 9).
- Password reset was split out of 003 into 005 to keep each review small; it only needs 003's
  email queue and token infrastructure.

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
10. (2026-09-29) A malformed email at login answers 400 `VALIDATION_ERROR` (contract), not 401:
    it validates shape only and reveals nothing about accounts.
11. (2026-09-29) Review round 1 of plan 001 (H2, H3) is fixed inside plan 001: session activity
    writes only `last_seen_at` of non-revoked sessions, and each login attempt is reserved under
    a row lock before the password is verified, so parallel bursts count every attempt.
12. (2026-09-29) The IP throttle has its own limit, `LOGIN_IP_MAX_FAILURES` (default 50 per
    15 min), separate from the email limit (5), and successful logins do not consume it — an
    office or a reverse proxy behind one IP must not lock everyone out.
13. (2026-09-30) Plan 002 enforces only the **holding** and **company** scopes (Admin holding,
    RRHH). Jefe directo and Colaborador stay in the catalog but grant nothing and cannot be
    assigned until their data exists (manager relation; `User.employeeId` in plan 003).
14. (2026-09-30) Only Admin holding creates companies; RRHH sees only the companies it is
    assigned to.
15. (2026-09-30) Role assignments are managed over HTTP by Admin holding (assign, list, revoke);
    the seed makes `admin@example.com` Admin holding. Creating users over HTTP stays in plan 003.
16. (2026-09-30) The deferred throttle finding (`plans/hallazgos/identity-throttle-reserva-ip.md`,
    L3/I4/I6) is fixed in plan 002.
17. (2026-09-30) Authorization runs before validating query and body: an anonymous or
    unauthorized caller never sees schema errors (401/403 first). Path params are still validated
    first because the company scope comes from them (plan 002 review R1).
18. (2026-09-30) Duplicate active role assignments are prevented by serializing `AssignRole` per
    user with a row lock (`SELECT … FOR UPDATE` on the user) — revised the same day: a partial
    unique index was the first choice, but Prisma 7.10 cannot declare partial indexes and a
    hand-written one risks being dropped by a later migration (plan 002 review R4, deviation 9).
    Note for plan 003: once users can be disabled, the last-admin rule must ignore disabled admins.
19. (2026-09-30) RRHH (for their companies) and Admin holding invite colaboradores. The
    invitation proposes the ficha's email but it can be changed (e.g. to a personal one); that
    email becomes the login email. Admin holding can also invite someone who is not a colaborador.
20. (2026-09-30) When a colaborador is terminated, their account is disabled at once and all
    their sessions are closed (reacting to `employees.employee.terminated`).
21. (2026-09-30) Emails (invitation, later reset) are sent through the job queue and the worker
    (BullMQ + SMTP; Mailpit in development), not synchronously from the API.
22. (2026-09-30) Activating an account linked to a colaborador grants the `EMPLOYEE` role
    automatically. For now it grants no permission beyond `/auth/me`; self-service endpoints come
    with their modules.
23. (2026-09-30) A password-reset link is valid for **1 hour** and can be used once.
24. (2026-09-30) Setting a new password through a reset closes **all** the user's sessions.
25. (2026-09-30) "Forgot my password" answers the same whether or not the email exists (no
    account enumeration).
26. (2026-09-30) Admin holding (any user) and RRHH (colaboradores of their companies) can force a
    reset for someone who cannot do it themselves. Forcing only **sends the reset email**; staff
    never choose or see the password.
27. (2026-09-30) The hallazgo "dos invitaciones simultáneas quedan ambas pendientes" (plan 003
    review L3) is fixed in plan 005.
28. (2026-09-30) A successful password reset also lifts the login block on that email (the IP
    block stays, since the IP is shared — decision 12).
29. (2026-09-30) Changing the password while signed in (current + new password) is not part of
    plan 005: it comes with the colaborador's self-service endpoints over their own data.
30. (2026-09-30) "Forgot my password" sends at most one email per account every **3 minutes**
    (`PASSWORD_RESET_COOLDOWN_SECONDS=180`); a repeated request inside that window still answers
    204 but sends nothing. Staff-forced resets are not subject to it.

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
