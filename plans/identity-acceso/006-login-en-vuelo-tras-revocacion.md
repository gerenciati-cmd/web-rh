---
status: review
module: identity
min_implementer: mid
depends_on: ['005']
---

# 006 — Un login en vuelo no sobrevive a "cerrar todas las sesiones"

## Context

`LogIn` reads the user and verifies the password with argon2
(`apps/api/src/modules/identity/application/commands/log-in.command.ts:91-101`). Only afterwards
does it save the new session, outside any transaction and without locking the user
(`log-in.command.ts:109-126`). Anyone who closes all sessions only revokes the sessions that exist
at that moment:

- `ResetPassword` (plan 005) locks the user row, changes the hash and calls `revokeAllForUser`.
- `DisableTerminatedEmployee` updates the user and calls `revokeAllForUser` in one transaction
  (`disable-terminated-employee.command.ts:36-52`).
- `revokeAllForUser` itself is in `infrastructure/prisma-session.repository.ts:31-37`.

So a login that verified the **old** password before one of those commits can still save its
session afterwards, and nothing ever revokes it. The report is in
`plans/hallazgos/identity-login-en-vuelo-sobrevive-revocacion.md`.

`UserRepository.lock(id)` (plan 005, `domain/user.repository.ts:14`) locks the user row until the
transaction ends.

**Approach.** Compared (a) saving the session inside a transaction that locks the user and
re-checks it with (b) a `password_changed_at` column checked on every request. Chose (a):

- It needs no schema change and adds no per-request cost, only one short row lock per successful
  login.
- The argon2 verification stays outside the lock.

Why (a) closes the race, whichever transaction takes the user row first:

- **The reset or termination goes first.** The login sees the new hash or the `DISABLED` status
  and fails.
- **The login goes first.** Its session is committed before the other transaction's
  `revokeAllForUser` runs, so that call revokes it.

This follows the lock-and-re-read shape of `ResetPassword`
(`application/commands/reset-password.command.ts`).

## Out of scope

- Option (b) and any change to per-request authentication (`session-authenticator.ts`).
- Changes to the login throttle logic, except moving the success-path `clear`/`release` after the
  session is saved (step 1).
- Any contract or endpoint change: the response stays 401 `INVALID_CREDENTIALS`, the same as a
  wrong password.

## Dependencies

- `identity-acceso/005` (`done`): provides `UserRepository.lock`, `ResetPassword` and
  `revokeAllForUser`.

## Steps

1. **Save the session under the user lock**
   - Files: `apps/api/src/modules/identity/application/commands/log-in.command.ts` (modify)
   - Do: after the password is verified (`:91-101`), replace the direct `sessionRepository.save` with:
     1. Build the session as today, then open `transactionRunner.run`.
     2. Inside it, run `userRepository.lock(user.id)`, then re-read the user with `findById`.
     3. If the user is missing, cannot sign in, or `snapshot.passwordHash` differs from the hash
        just verified, throw an internal `CredentialsChangedError`. Otherwise save the session.
     4. Catch `CredentialsChangedError` and return `err(new InvalidCredentialsError())`, with no
        session saved and no event published. Mirror
        `activate-account.command.ts:39-40,117-122`.
     5. Only after a successful save, run the success-path throttle `clear(emailKey)` and
        `release(ipKey)`. Today they run before the save (`:106-107`). On the rejected path, the
        reserved attempt stays counted, like any failed login.

     Add a short comment explaining why: `revokeAllForUser` only revokes sessions that already
     exist.

   - Observable result: typecheck; existing `log-in.command.test.ts` and `tests/auth.test.ts` stay green.

2. **Docs**
   - Files: `plans/hallazgos/identity-login-en-vuelo-sobrevive-revocacion.md` (modify), `plans/identity-acceso/README.md` (modify)
   - Do: in the hallazgo, set `status: resolved` and `plan: identity-acceso/006`. In the README,
     add the plan 006 row (already added at planning time; adjust only if needed).
   - Observable result: `pnpm plans:lint` green.

3. **Test files of this plan** (declared for `pnpm plans:scope`; the tester writes them)
   - Files: `apps/api/src/modules/identity/application/commands/log-in.command.test.ts` (modify), `apps/api/tests/integration/identity/log-in-race.int.test.ts` (create)
   - Do: nothing for the implementer.
   - Observable result: suites green.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm test:integration` pass.
- [ ] Normal login is unchanged: 200 with a session. Wrong password and a disabled user still give
      401 `INVALID_CREDENTIALS`. The throttle still blocks after the configured failures, and a
      successful login still clears the email throttle.
- [ ] Against real Postgres, `LogIn` runs in parallel with `ResetPassword` or
      `DisableTerminatedEmployee`, and the password verification is held until the other
      transaction has committed. The outcome must be one of two, never an active session left
      behind by the stale login:
  - the login is rejected with `INVALID_CREDENTIALS` and saves no session; or
  - its session exists but is revoked.

  Checked by an integration test. The verifier also confirms the normal login flows over HTTP.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                        |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | no      | no domain change                                                                                                                                                             |
| application | yes     | `LogIn` rejects with `INVALID_CREDENTIALS` when the re-read user changed hash or was disabled after verification; no session and no event; throttle not cleared on that path |
| contract    | no      | no contract change                                                                                                                                                           |
| http        | no      | existing `tests/auth.test.ts` covers the unchanged flows                                                                                                                     |
| integration | yes     | the stale login races a real `ResetPassword` and `DisableTerminatedEmployee` (verification held until they commit); no active session survives                               |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                  |

## Deviations

None.

## Test coverage

Baseline (`pnpm check`): green before writing tests (api 516 passed, 3 skipped). Closing: `pnpm check`
green (api 519 passed, 3 skipped) and `pnpm test:integration` green (11 files, 115 tests).

| Behavior (from plan / code)                                                                                            | Source (`file:line`)                | Layer       | Test                                                                                      | State     |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------- | ----------------------------------------------------------------------------------------- | --------- |
| Password changed after verification: `INVALID_CREDENTIALS`, no session, no event, email and IP throttles not cleared   | `log-in.command.ts:121-122,161-163` | application | `log-in.command.test.ts › la contraseña cambió: …`                                        | CONFIRMED |
| User became `DISABLED` after verification: same outcome                                                                | `log-in.command.ts:161`             | application | `log-in.command.test.ts › el usuario quedó DISABLED: …`                                   | CONFIRMED |
| User missing on re-read: same outcome                                                                                  | `log-in.command.ts:161`             | application | `log-in.command.test.ts › el usuario ya no existe: …`                                     | CONFIRMED |
| Success path still clears email throttle, saves session, publishes event (unchanged flow)                              | `log-in.command.ts:124-130`         | application | existing `login exitoso: …`                                                               | CONFIRMED |
| Real `ResetPassword` commits while login is held after verifying the old hash: login rejected, zero sessions           | `log-in.command.ts:158-165`         | integration | `log-in-race.int.test.ts › ResetPassword confirma durante la verificación: …`             | CONFIRMED |
| Real `DisableTerminatedEmployee` commits while login is held after verifying: login rejected, zero sessions            | `log-in.command.ts:158-165`         | integration | `log-in-race.int.test.ts › DisableTerminatedEmployee confirma durante la verificación: …` | CONFIRMED |
| Login holds the user lock first, `ResetPassword` waits, then revokes the login's session (row exists, `revokedAt` set) | `log-in.command.ts:159-164`         | integration | `log-in-race.int.test.ts › ResetPassword espera al login y luego revoca …`                | CONFIRMED |
| Login holds the user lock first, `DisableTerminatedEmployee` waits, then revokes the login's session                   | `log-in.command.ts:159-164`         | integration | `log-in-race.int.test.ts › DisableTerminatedEmployee espera al login y luego revoca …`    | CONFIRMED |
| Normal login without a race leaves one active session (real Postgres)                                                  | `log-in.command.ts:158-165`         | integration | `log-in-race.int.test.ts › sin carrera: …`                                                | CONFIRMED |
| HTTP flows unchanged (200 with session, 401 wrong password / disabled, throttle)                                       | —                                   | http        | existing `tests/auth.test.ts` (green in both runs); no new test, per plan                 | CONFIRMED |

Counts: application 3 new (log-in file 11 to 14), integration 5 new. Races are made deterministic
with promise gates (no sleeps): a hasher that holds after `verify`, and a user repository that holds
after `lock`. No product code was changed and no GAP or NOT CONFIRMED items arose. Note: the tests
were not run against a pre-fix build (no baseline mutation allowed), so their ability to fail
without the fix is argued from the gates, not demonstrated.

## Review findings

## Verification
