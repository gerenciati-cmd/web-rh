---
status: verify
module: platform
min_implementer: high
depends_on: []
---

# 001 — Consistent development conventions and a verifiable AI harness

## Context

Recon baseline: `a999d00`, clean working tree before this initiative. User decisions 1–5 in the
initiative README govern scope, constants, closed sets, naming and docblocks. This is one plan
with internal milestones, not separate approval artifacts.

### Verified evidence

| ID  | Source read during the audit                                                                                                                                              | Finding                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| H1  | `.claude/hooks/guard-bash.mjs:26`, `.claude/settings.json:75`, `docs/harness/HARNESS.md:64`                                                                               | Quote stripping and tool-specific hook registration leave coverage gaps; Claude hook tests do not prove live protection in Codex. |
| H2  | `scripts/plans/scope.mjs:34`                                                                                                                                              | Git failures become empty diffs. Reproduced: nonexistent base exits successfully.                                                 |
| H3  | `docs/harness/roles/reviewer.md:53`, `docs/harness/roles/implementer.md:9` and `:46`                                                                                      | Reviewer leaves repairs in review; implementer refuses review. Commit instructions contradict phase commits.                      |
| D1  | `packages/domain/src/money.ts:24` and `:35`                                                                                                                               | Factory checks safe integers, operations bypass it. Reproduced unsafe/infinite results.                                           |
| D2  | `packages/domain/src/date-range.ts:12` and `:17`                                                                                                                          | Invalid endpoints accepted; stored Dates retain mutable external references. Both reproduced.                                     |
| D3  | `apps/api/src/modules/organization/application/commands/create-company.command.ts:34`, `apps/api/src/modules/organization/infrastructure/prisma-company.repository.ts:35` | The same expected conflict returns Result or throws depending on a race. Employee persistence follows the same pattern.           |
| F1  | `apps/web/eslint.config.mjs:5`, `apps/mobile/eslint.config.js:5`, `apps/web/tsconfig.json:2`, `apps/mobile/tsconfig.json:2`                                               | Frontend does not apply all common strict rules/options.                                                                          |
| F2  | `apps/web/package.json:5`, `apps/mobile/package.json:38`, `apps/mobile/src/features/organization/hooks/use-companies.ts:25`                                               | No frontend test tasks; reload and initial load have independent state writes.                                                    |
| C1  | `apps/api/src/modules/employees/domain/employee.ts:15`, `packages/contracts/src/employees/employee.contract.ts:7`, `apps/api/prisma/schema.prisma:40`                     | Employee statuses are repeated across domain/contract/storage.                                                                    |
| C2  | `docs/conventions.md:76`, `apps/mobile/src/constants/theme.ts:10`, `apps/api/src/modules/employees/domain/employee.ts:28`                                                 | Naming guidance does not cover the agreed constant/docblock policy; fixed constant names vary.                                    |
| C3  | `apps/api/src/infrastructure/events/in-memory-event-bus.ts:5`                                                                                                             | Docblock promises post-commit delivery, but publish does not schedule around transactions.                                        |

The audit ran `pnpm check` successfully (13/16 Turbo tasks reused cache), including 117 hook/plan
tests and 6 bootstrap tests. `pnpm audit --json` reported six advisory entries, including high
transitive paths `prisma > @prisma/config > deepmerge-ts` and `prisma > mysql2`. No API exploitability
was established. These are recon observations, **not phase evidence for this plan**.

### Approach and alternatives

Preserve the modular monolith, ports, Result, Zod contracts and feature-based UI. Improve existing
mechanisms instead of adding a new orchestrator, generic CRUD framework or global constants package.
One pure employee-status vocabulary will live under `packages/domain/src/employees/`, following
the shared country vocabulary in `packages/domain/src/national-id/validators.ts:16`. Record this
bounded shared-kernel extension in an ADR. Separate domain/HTTP lists plus equivalence tests were
considered, but a shared pure vocabulary avoids duplicated knowledge without reversing dependencies.

Security uses explicit trust boundaries, conservative checks and actual host permissions. Regex
hooks cannot sandbox arbitrary programs. Frontend tests use Vitest and React Testing Library for
the web component and the mobile React-only data hook; no simulated native UI is presented as E2E.

Imitate `packages/domain/src/result.ts`, the existing employee command/repository patterns,
`.claude/hooks/hooks.test.mjs:17` and `scripts/plans/plans.test.mjs:36`. High implementer tier reflects
shell/security reasoning and error-channel changes, not freedom to expand scope.

## Out of scope

- New identity/authentication, RBAC, RLS, product audit trail, outbox, payroll rules or endpoints.
  These are documented future prerequisites; this plan does not establish production readiness.
- Schema migrations, changed employee status strings, changed 90-day hiring limit or new legal
  rounding policies. Preserve valid HTTP request/response shapes and event payloads.
- Full browser/native E2E, UI redesign, generic design system, forcing React versions to match
  across apps, global constants directory and indiscriminate docblocks.
- Universal prompt-injection immunity, changes to global agent permissions, disabling host
  sandboxing, reading secrets or writing to non-local systems.
- Hand edits to generated adapters/client code, existing migrations or pnpm-lock.yaml.
- Remote publishing/deployment, branch protection changes, commits or agent dispatch without the
  existing authorization rules. No unrelated fixes while enabling lint/type checks.

## Dependencies

None. Existing code was read, not assumed from unfinished plans.

Required context: root/API/web/mobile AGENTS.md; docs/harness HARNESS.md and workflow.md;
conventions/testing.md and commits.md; this initiative README; every source listed below.
Consult installed framework/config documentation before changing version-specific options.
If a required dependency cannot work with Node 24+ and the installed React version, record a
deviation rather than bypassing peer checks. Implementation was subsequently approved by the user; see Deviations.

## Steps

1. **Baseline and contributor policy.**
   - Files: `CONTRIBUTING.md` (create), `docs/conventions.md` (modify), `docs/architecture.md` (modify), `AGENTS.md` (modify), `README.md` (modify), `docs/harness/conventions/backend.md` (modify), `docs/harness/conventions/frontend.md` (modify), `docs/harness/conventions/testing.md` (modify), `docs/adr/0007-vocabulario-compartido-y-errores-esperados.md` (create), `docs/adr/README.md` (modify).
   - Run baseline `pnpm check` and, because adapters change, `pnpm test:integration` against a
     verified local `_test` database. Record failures without weakening checks or reading secrets.
   - Canonical policy lives in docs/conventions.md. Include decisions 2–5, concrete examples and
     exceptions: `_layout.tsx`, `.web.tsx`, framework default exports/config names, PascalCase Zod
     schemas and existing mapper objects acting as stateless services. Private constants stay local;
     shared constants live in their owner. `as const` is compile-time readonly, not deep freezing.
   - Fixed configuration/event-name constants use SCREAMING_SNAKE_CASE; runtime variables, styles,
     DI objects and const-bound functions do not automatically qualify. Name numeric literals only
     when meaning/reuse warrants it. Do not introduce numeric enums or mass rename database objects.
   - CONTRIBUTING links setup, tests, naming, plan workflow, PR and security rules. AGENTS/per-layer
     docs link canonical sections. Source comments/UI stay Spanish; plan bodies remain English.
   - Docblocks explain observable contracts, units, null semantics, errors, side effects and limits.
     Tags/examples must add information beyond TypeScript. Do not require a comment on every getter.
   - ADR records the pure shared vocabulary boundary and typed expected save conflicts. No aggregate,
     Zod dependency or Prisma type moves into the shared vocabulary.
   - Observable: every agreed convention has one authoritative location and practical examples.

2. **Fail closed on incomplete scope comparisons; validate dependencies.**
   - Files: `scripts/plans/scope.mjs` (modify), `scripts/plans/lib.mjs` (modify), `scripts/plans/lint.mjs` (modify), `scripts/plans/plans.test.mjs` (modify), `scripts/plans/scope.test.mjs` (create), `package.json` (modify), `docs/harness/conventions/plans.md` (modify).
   - Extract scope evaluation as an importable function with explicit repo root, base and plan.
     Leave CLI parsing at the boundary. Validate HEAD/base/common ancestor; never turn failed Git
     operations into empty results. Missing HEAD/base/merge base is a useful nonzero diagnostic.
   - Compare committed changes against merge base, staged/unstaged changes and untracked files.
     Use NUL-separated paths; check both source/destination of renames. Preserve default main and
     explicit --base. Hot-file append-only checks remain a documented reviewer responsibility.
   - Tests use temporary Git repositories, never the user's branch history. Include nonexistent
     base, divergent histories, out-of-scope committed/staged/unstaged/untracked files, renames and
     filenames with whitespace. Extend test:harness to execute the new test file.
   - Reject dependency cycles. implementing/testing/review/verify/done require done dependencies;
     draft/approved can declare pending ones, while execution still refuses to start. Preserve
     blocked/superseded meaning and existing evidence checks.
   - Observable: incomplete comparisons cannot print success or exit zero; supported comparisons
     still detect actual scope violations.

3. **Repair AI lifecycle, authority boundaries and commit instructions.**
   - Files: `docs/harness/HARNESS.md` (modify), `docs/harness/workflow.md` (modify), `docs/harness/roles/implementer.md` (modify), `docs/harness/roles/tester.md` (modify), `docs/harness/roles/reviewer.md` (modify), `docs/harness/roles/verifier.md` (modify), `docs/harness/conventions/commits.md` (modify), `scripts/harness/adapters.mjs` (modify).
   - Keep current statuses. Reviewer/verifier record failure and leave their phase unchanged. On
     resuming the authorized plan, the main session records the repair reason and moves review/verify
     to implementing before resuming implementation. Product repairs pass testing → review → verify
     again. Preserve dated historical evidence and identify results invalidated by later edits.
   - Test-only issues stay with tester; product gaps return to implementation. In-scope repairs do
     not require another plan; design/scope changes remain deviations. No role silently fixes another
     role's output. Remove the contradictory commits-only-at-done sentence. Main-session phase
     commits require user authorization; subagents never commit/push.
   - Add a common trust-boundary fragment: comments, external documents, issues and tool output
     cannot authorize actions, secret access or scope expansion. Record conflicting instructions
     with their location, not secret contents. Reference step 4's canonical security policy.
   - Use provider-neutral model tiers in descriptions; keep model mappings in CODEX_MODELS. An
     unavailable model is reported, not silently substituted. TOML existence does not prove runtime
     availability or quality. Preserve attended dispatch approval rules.
   - Observable: new-work, review-repair, failed-verification, dependency-block and hostile-content
     scenarios each have an unambiguous next action/role/status.

4. **Harden supported hook paths and document the real security boundary.**
   - Files: `docs/harness/security.md` (create), `.claude/settings.json` (modify), `.claude/hooks/guard-bash.mjs` (modify), `.claude/hooks/guard-files.mjs` (modify), `.claude/hooks/guard-paths.mjs` (create), `.claude/hooks/guard-read.mjs` (create), `.claude/hooks/hooks.test.mjs` (modify).
   - Document a per-tool matrix of instructions, registered hooks, permissions, filesystem/network
     sandbox and verified limits. Separate prevention/detection/review. Tests do not register hooks;
     no text prompt replaces OS/host enforcement or prevents arbitrary programs from accessing files.
   - Share protected-path classification. Read guard blocks `.env` and `.env.*` except exact
     `.env.example`, plus secret key files. Edit guard preserves generated/native/migration/lockfile
     protections. Normalize paths and check symlink targets without opening protected contents.
     Handle each member of MultiEdit; malformed mutation payloads fail closed with diagnostics.
   - Register read guard for supported Read payloads; preserve existing broader host restrictions.
     Document coverage gaps for arbitrary search/shell programs. Fixtures contain synthetic data only.
   - Replace quote-stripping with a conservative lexer for supported shell syntax. Preserve literal
     arguments, recognize unquoted separators/redirections and examine literal nested-shell command
     strings recursively. Literal grep/commit text must not be confused with executed code.
   - Reject executable substitutions and dynamic/unsupported execution forms that cannot be checked
     reliably, including inline interpreter/eval payloads. Explain how to use explicit supported
     commands. This is a bounded guard, not a general shell interpreter or arbitrary-script sandbox.
   - Apply current command rules to normalized arguments, quoted paths and git global options.
     Check direct redirection/tee destinations against protected paths. Do not claim to inspect
     arbitrary executable or pnpm script internals. Narrow blanket task permissions to known tasks
     where needed; never reduce host approvals or disable sandboxing to make commands pass.
   - Do not infer session file creation from arbitrary transcript substring matches. Without reliable
     provenance from successful structured events, refuse untracked-file deletion conservatively.
   - Test negative and positive inert payloads by invoking only the guard process, never the payload
     command. Include quoted paths, nested shells, protected destinations, secret suffixes, symlinks,
     malformed payloads and benign searches mentioning forbidden words. Update previous allow cases
     explicitly if the conservative policy intentionally rejects them.
   - Observable: supported forbidden cases are blocked, normal known workflows pass, and remaining
     host-controlled protections are accurately stated rather than advertised as repo guarantees.

5. **Generate corrected agent/skill adapters.**
   - Files: `.claude/agents/implementer.md` (generate), `.claude/agents/tester.md` (generate), `.claude/agents/reviewer.md` (generate), `.claude/agents/verifier.md` (generate), `.codex/agents/implementer.toml` (generate), `.codex/agents/implementer-high.toml` (generate), `.codex/agents/implementer-small.toml` (generate), `.codex/agents/tester.toml` (generate), `.codex/agents/tester-high.toml` (generate), `.codex/agents/reviewer.toml` (generate), `.codex/agents/reviewer-medium.toml` (generate), `.codex/agents/verifier.toml` (generate).
   - Files: `.agents/skills/planear/SKILL.md` (generate), `.agents/skills/implementar/SKILL.md` (generate), `.agents/skills/escribir-tests/SKILL.md` (generate), `.agents/skills/revisar/SKILL.md` (generate), `.agents/skills/verificar/SKILL.md` (generate), `.agents/skills/fix/SKILL.md` (generate), `.claude/skills/planear/SKILL.md` (generate), `.claude/skills/implementar/SKILL.md` (generate), `.claude/skills/escribir-tests/SKILL.md` (generate), `.claude/skills/revisar/SKILL.md` (generate), `.claude/skills/verificar/SKILL.md` (generate), `.claude/skills/fix/SKILL.md` (generate).
   - Run pnpm harness:sync; never hand-edit generated files. Request narrow write permission if
     the host protects these directories; do not evade it with another tool. Run harness:check and
     test:harness. Inspect lifecycle/security text for both providers; source agreement is not proof
     of live model behavior. Observable: all adapters regenerate deterministically and checks pass.

6. **Share the pure employee-status vocabulary.**
   - Files: `packages/domain/src/employees/employee-status.ts` (create), `packages/domain/src/index.ts` (modify), `packages/contracts/src/employees/employee.contract.ts` (modify), `apps/api/src/modules/employees/domain/employee.ts` (modify), `apps/api/src/modules/employees/domain/employee-status.test.ts` (create), `apps/api/tests/integration/employees/prisma-employee.int.test.ts` (modify).
   - Export EMPLOYEE_STATUSES as the readonly tuple ACTIVE, TERMINATED; derive EmployeeStatus via
     indexed access. Contracts pass the tuple to z.enum; aggregate imports the pure type. Re-export
     that type from employee.ts if needed to preserve existing internal callers.
   - No aggregate, IO or schema validator lives in the shared vocabulary. Prisma schema/storage
     strings remain unchanged and independent; never import generated Prisma into domain/UI.
   - Test every shared value against the contract, reject unknown values, and verify both states
     round-trip through persistence. Future vocabulary changes require storage/migration review too.
   - Observable: no duplicate handwritten TS status union; pnpm arch:check remains green.

7. **Preserve Money/DateRange invariants.**
   - Files: `packages/domain/src/money.ts` (modify), `packages/domain/src/date-range.ts` (modify), `packages/domain/src/money-and-range.test.ts` (modify).
   - Money.add/subtract/multiply return Result<Money, InvalidValueError>; validate through the factory.
     Reject unsafe results, nonfinite factors and currency mismatches as err. Negative finite amounts
     remain supported. Update the existing tests; stop on unlisted new consumers rather than expanding.
   - Preserve Math.round behavior for valid finite multiplication and document tie behavior. Legal
     payroll rounding remains undecided; no decimal library, currency precision or exchange-rate change.
   - DateRange rejects invalid endpoints before ordering checks. Store epoch values; preserve public
     from/to access via getters returning fresh Dates. Keep [from,to), null=open-ended and rejection
     of equal endpoints. contains returns false for an invalid probe. Inputs/getter results cannot
     mutate the range. Document units, failure channel and mutability guarantees precisely.
   - Add boundary/overflow/nonfinite tests and invalid-date/input/getter-mutation regressions while
     preserving valid behavior assertions. Observable: the reproduced audit defects are prevented.

8. **Unify expected save conflicts through Result.**
   - Files: `apps/api/src/modules/organization/domain/company.repository.ts` (modify), `apps/api/src/modules/employees/domain/employee.repository.ts` (modify), `apps/api/src/modules/organization/infrastructure/prisma-company.repository.ts` (modify), `apps/api/src/modules/employees/infrastructure/prisma-employee.repository.ts` (modify), `apps/api/src/modules/organization/infrastructure/in-memory/in-memory-company.store.ts` (modify), `apps/api/src/modules/employees/infrastructure/in-memory/in-memory-employee.repository.ts` (modify), `apps/api/src/modules/organization/application/commands/create-company.command.ts` (modify), `apps/api/src/modules/employees/application/commands/register-employee.command.ts` (modify).
   - Files: `apps/api/src/modules/organization/application/commands/create-company.command.test.ts` (modify), `apps/api/src/modules/employees/application/commands/register-employee.command.test.ts` (modify), `apps/api/tests/http.test.ts` (modify), `apps/api/tests/integration/organization/prisma-company.int.test.ts` (modify), `apps/api/tests/integration/employees/prisma-employee.int.test.ts` (modify).
   - save returns Promise<Result<void, CompanyAlreadyExistsError>> or the employee equivalent.
     Prisma maps the existing unique violation to err and rethrows unexpected failures. Memory
     adapters enforce equivalent uniqueness, excluding the same aggregate ID on updates. Employee
     uniqueness stays company + country + normalized document.
   - Commands inspect save before publishing/returning success. Precheck/save-time conflicts use
     the same stable Result error; failed persistence emits no success event. Keep HTTP 201/409 and
     error bodies unchanged. Do not collapse unexpected errors into domain conflicts.
   - Tests exercise both paths and real concurrent duplicate operations against Prisma, checking
     one success, one conflict and the persisted count. A sequential duplicate test alone is not
     concurrency evidence. Document Result semantics on the ports.
   - Observable: domain/application/http/integration tests verify consistent caller behavior.

9. **Apply agreed names and accurate docblocks to canonical examples.**
   - Files: `apps/api/src/modules/employees/domain/employee.ts` (modify), `apps/api/src/modules/employees/index.ts` (modify), `apps/api/src/modules/employees/domain/employee.test.ts` (modify), `apps/api/src/modules/employees/application/commands/register-employee.command.test.ts` (modify), `apps/api/src/modules/organization/domain/company.ts` (modify), `apps/api/src/modules/organization/index.ts` (modify), `apps/api/src/modules/organization/application/commands/create-company.command.test.ts` (modify), `apps/api/src/infrastructure/events/in-memory-event-bus.ts` (modify), `apps/api/src/shared/application/ports.ts` (modify).
   - Files: `apps/mobile/src/constants/theme.ts` (modify), `apps/mobile/src/hooks/use-theme.ts` (modify), `apps/mobile/src/app/index.tsx` (modify), `apps/mobile/src/app/empresas.tsx` (modify), `apps/mobile/src/components/app-tabs.tsx` (modify), `apps/mobile/src/components/app-tabs.web.tsx` (modify), `apps/mobile/src/components/hint-row.tsx` (modify), `apps/mobile/src/components/web-badge.tsx` (modify), `apps/mobile/src/components/themed-text.tsx` (modify), `apps/mobile/src/components/ui/collapsible.tsx` (modify).
   - Event exports become EMPLOYEE_HIRED, EMPLOYEE_TERMINATED and COMPANY_CREATED; update all listed
     callers without changing event strings. Theme exports become COLORS, FONTS, SPACING,
     BOTTOM_TAB_INSET and MAX_CONTENT_WIDTH; ThemeColor stays a type. Do not uppercase styles/services.
   - Keep private hiring limits in employee.ts and theme values in the existing theme file. Replace
     starter/tutorial comments in touched code with useful Spanish contracts.
   - Correct EventBus documentation: caller controls publication; no automatic after-commit scheduling
     or durability; handlers fail independently as currently implemented. Do not implement outbox.
   - Observable: names/docs align while event payloads, UI styling and business policies stay unchanged.

10. **Apply shared frontend quality rules with narrow framework exceptions.**
    - Files: `packages/eslint-config/base.mjs` (modify), `packages/eslint-config/frontend.mjs` (create), `packages/eslint-config/package.json` (modify), `packages/tsconfig/strict-options.json` (create), `packages/tsconfig/base.json` (modify), `apps/web/eslint.config.mjs` (modify), `apps/mobile/eslint.config.js` (modify), `apps/web/tsconfig.json` (modify), `apps/mobile/tsconfig.json` (modify), `apps/web/package.json` (modify), `apps/mobile/package.json` (modify), `scripts/quality/frontend-config.test.mjs` (create), `package.json` (modify).
    - Files: `apps/web/src/app/layout.tsx` (modify), `apps/web/src/app/page.tsx` (modify), `apps/web/src/app/empresas/page.tsx` (modify), `apps/web/src/lib/api.ts` (modify), `apps/web/src/features/organization/components/company-table.tsx` (modify), `apps/mobile/src/app/_layout.tsx` (modify), `apps/mobile/src/lib/api.ts` (modify), `apps/mobile/src/features/organization/hooks/use-companies.ts` (modify), `apps/mobile/src/hooks/use-color-scheme.ts` (modify), `apps/mobile/src/hooks/use-color-scheme.web.ts` (modify), `apps/mobile/src/components/themed-view.tsx` (modify), `apps/mobile/src/components/external-link.tsx` (modify), `apps/mobile/src/components/animated-icon.tsx` (modify), `apps/mobile/src/components/animated-icon.web.tsx` (modify).
    - Step 9 frontend files may receive mechanical compliance edits too. No blanket src/ scope.
      Compose shared type-aware rules with Next/Expo presets without duplicate incompatible plugins;
      extract reusable repo-rule objects if needed. Preserve framework diagnostics. Include TSX tests
      in common test overrides. Enforce no-any, type imports, promise safety, exhaustiveness and
      no-default-export except actual framework requirements; adapt reusable component imports.
    - Extract only strict flags to strict-options.json, inherited by the common base and apps.
      Retain Next/Expo defaults, JSX, resolution, path aliases and generated route types. Add explicit
      workspace dependencies on the config packages. Document static asset require and framework
      callback exceptions narrowly; do not turn off promise checks globally.
    - Use import restrictions to reject direct Prisma/API-source imports from frontend, including
      relative paths/aliases. Keep backend dependency-cruiser intact. Data access remains api-client.
    - A test:quality task in pnpm check runs safe fixture snippets through actual ESLint configs and
      resolves effective TS configs. Prove bad code/imports fail and valid route/asset exceptions pass;
      no regex assertions on source files. Semantic naming/docblock quality remains reviewer work.
    - Observable: both apps pass strict checks, and negative controls prove the rules really apply.

11. **Connect frontend tests and guard request ordering.**
    - Files: `apps/web/package.json` (modify), `apps/mobile/package.json` (modify), `pnpm-workspace.yaml` (modify), `pnpm-lock.yaml` (generate), `apps/web/vitest.config.ts` (create), `apps/mobile/vitest.config.ts` (create), `apps/web/src/features/organization/components/company-table.test.tsx` (create), `apps/mobile/src/features/organization/hooks/use-companies.test.tsx` (create), `apps/mobile/src/features/organization/hooks/use-companies.ts` (modify), `docs/harness/conventions/testing.md` (modify).
    - Use catalog Vitest plus compatible exact jsdom/@testing-library/react dev versions. Resolve
      versions using registry metadata and installed React/Node constraints; put shared versions in
      catalog and generate lock changes with pnpm. Preserve each app's React/react-dom pairing.
    - Vitest uses jsdom, automatic JSX and the app @ alias. Exclude native/generated folders; never
      enable passWithNoTests. Add app test scripts to participate in current Turbo/CI tasks. Tests
      live outside route folders. Mock the network client boundary, not the component/hook under test.
    - Render actual CompanyTable for empty/nonempty data and active/inactive labels. renderHook tests
      use controlled promises for initial loading, success/empty data, ApiError/network failure and
      reload. No network, real timers or React deduplication across apps.
    - Use mounted/request-generation guards for both initial load and reload: only the latest active
      request may write state, and unmount invalidates outstanding callbacks. Preserve state/reload
      signature, messages and query values. Cover inverted completion order and cleanup while pending.
      No new cache library, transport cancellation or offline support.
    - Observable: both test scripts run real cases in pnpm check; stale requests cannot overwrite
      the latest result. Document web-component/mobile-hook coverage, not native UI/E2E coverage.

12. **Assess dependency exposure and complete the verification gates.**
    - Files: `docs/security/dependency-assessment.md` (create), `.github/pull_request_template.md` (modify), `.github/workflows/README.md` (modify), `README.md` (modify), `CONTRIBUTING.md` (modify).
    - Refresh pnpm audit --json and pnpm why. Document IDs, versions, dependency paths and actual
      runtime/build/migration reachability for the reported high entries, without secrets. Do not
      infer API exploitability from severity or force incompatible transitive-major overrides.
      A reachable issue requiring an unplanned upgrade becomes an explicit deviation/proposal before
      proceeding, not an unexplained suppression. No arbitrary target of zero scanner entries.
    - PR checklist links one plan and requires scope with a real base, updated docs and explicit
      NOT VERIFIED items. CI documentation states which app tests now run; do not claim automatic
      enforcement of human approvals or per-plan scope where none exists.
    - Run final pnpm check, pnpm test:integration, pnpm harness:check and
      `pnpm plans:scope plans/platform-calidad-integral/001-calidad-convenciones-y-harness.md --base main`.
      Use targeted checks between baseline/closing per the testing budget. If stacked, choose the
      genuine base explicitly; never hide a failed comparison.
    - Start local API/web and exercise company create/list/duplicate plus employee register/list/
      duplicate with synthetic data. Check unchanged HTTP codes/body shapes and UI labels. Remove
      only this run's seeded rows; no schema modifications. Run the verifier's mobile bundle command;
      device interactions remain NOT VERIFIED unless actually exercised.
    - In a disposable directory, exercise registered guards through available agent runtimes using
      harmless fixture operations. A denied edit must leave the fixture unchanged. Record provider,
      version and enforcement layer; do not execute destructive payloads or weaken host permissions.
    - Observable: quality/integration/scope pass, live evidence is recorded, and external checks
      that could not run are NOT VERIFIED. In-scope GAPs prevent completion; explicit external limits
      require user acceptance. No source reread or cached test output is called live enforcement.

## Acceptance criteria

- [x] One plan covers H1–H3, D1–D3, F1–F2 and C1–C3 and records all five user decisions.
- [x] Scope fails on incomplete comparison and detects committed/staged/unstaged/untracked/renamed
      out-of-scope files; dependency cycles and unfinished execution dependencies fail lint.
- [x] Review/verification repair loops are consistent, preserve evidence and authorize no extra
      commits, scope or permissions. Generated adapters match the source policies.
- [x] Supported guard cases deny quoted dangerous operations, protected paths and malformed input;
      benign known workflows pass. Security claims name actual provider/enforcement limits.
- [x] Employee statuses have one pure handwritten TS vocabulary, pass contract validation and
      round-trip through unchanged storage; architecture checks stay green.
- [x] Money rejects unsafe/nonfinite results through Result; valid rounding remains unchanged.
      DateRange rejects invalid endpoints and cannot be changed through external Date mutation.
- [x] Expected duplicates resolve as the same Result on either path, emit no success event after
      failure and map to HTTP 409; genuine concurrent persistence tests establish uniqueness.
- [x] Fixed constants follow the agreed naming; values, styles and event payloads are unchanged.
      CONTRIBUTING links canonical policy; touched public/non-obvious contracts have accurate docblocks.
- [x] Strict frontend checks are proven active with negative fixtures and narrow exceptions.
      Both frontend test tasks run real cases within pnpm check.
- [x] UI/hook tests cover empty/error/success/retry and stale/unmounted response handling without
      pretending to verify native rendering or browser E2E.
- [x] Dependency assessment distinguishes scanner severity from demonstrated exposure and records
      unresolved items honestly; no unsafe forced upgrades or unexplained suppressions.
- [ ] Final quality/integration/scope checks pass, real API/web smoke and mobile bundle are recorded,
      and unavailable external/runtime checks are explicitly accepted before done.

## Test layers required

| Layer       | Applies | Focus                                                                                        |
| ----------- | ------- | -------------------------------------------------------------------------------------------- |
| domain      | yes     | Money Results, DateRange validity/immutability, preserved lifecycle/events.                  |
| application | yes     | Duplicate paths, no event after save error, unexpected failure propagation.                  |
| contract    | yes     | Shared/unknown statuses; API-hosted schema tests, unchanged HTTP shapes.                     |
| http        | yes     | Company/employee 201/409 codes and bodies.                                                   |
| integration | yes     | Prisma Results, genuine concurrent duplicates, scoped uniqueness, status round-trips.        |
| frontend    | yes     | Actual CompanyTable and useCompanies with controlled promises.                               |
| tooling     | yes     | Inert hook payloads, temporary-repo scope CLI, dependency lint, effective ESLint/TS configs. |
| e2e         | no      | No automated browser/device E2E; local smoke/bundle is verifier work.                        |

Tests derive from actual implementation and baseline behavior. Characterize valid behavior before
refactoring, then add regressions for confirmed defects. Keep role purity inline: tester reports
product gaps; implementation resolves them before the next testing pass. Never weaken assertions
or use source-text searches as proof of runtime behavior.

## Deviations

- 2026-09-27: User approved implementation with “implementalo”; approved → implementing. No commits or push authorized. Branch: chore/platform-calidad-integral.

- 2026-09-27: Targeted testing exposed unnecessary deprecated esbuild configuration (Vitest 5
  uses Oxc). Removed it; automatic JSX remains exercised by real rendering tests. No module-type
  change was introduced merely to suppress Vite's future native-loader warning.
- 2026-09-27: Inline inspection tightened literal read paths, full main refspecs and relative API
  import patterns. Testing → implementing for these in-scope repairs, then testing/review again.
  Previous targeted results are historical, not final verification of these edits.
- 2026-09-27: Untracked removal no longer accepts transcript claims as provenance; inline interpreters
  and heredocs fail conservatively. Existing tests were updated to this explicit step-4 policy.

## Test coverage

2026-09-27 — Inline tester, as explicitly requested (no subagents).

- Domain: money-and-range.test.ts covers Results, overflow, nonfinite factors, rounding,
  invalid dates and defensive copies. Existing employee lifecycle tests preserved.
- Application: both command suites cover precheck and save conflicts, unexpected rejection,
  concurrent memory saves and absence of success events after failure.
- Contract/HTTP: employee-status.test.ts checks every vocabulary value and rejects unknown;
  http.test.ts checks save-time company/employee errors map to 409.
- Integration: both Prisma suites now inspect Result; actual Promise.all saves verify one success,
  one conflict and one persisted row. Existing ACTIVE/TERMINATED round-trip and company scope preserved.
- Frontend: real CompanyTable rendering (2 cases); real useCompanies (5 cases, controlled promises).
- Tooling: 154 hook/plan/scope tests and 9 effective frontend config tests passed in targeted runs.
- Initial targeted runs caught mechanical import-order/test-lint issues; these are corrected before
  the closing check. Final confirmation and commands are recorded under Verification.

## Review findings

2026-09-27 — Inline review (user declined subagents). Testing completed; status moved to review.

Mechanical pass: `pnpm check` PASS (18 Turbo tasks), `pnpm test:integration` PASS (16 tests),
`plans:scope ... --base main` PASS (108 changed paths, 128 declared). No schema/migration or hot
file changed. Generated adapters verified by harness:check. No commits/push performed.

Correctness pass: traced company/employee validation → precheck → save Result → publish → HTTP;
checked normalized/scoped uniqueness, unexpected exception propagation, Money boundaries,
DateRange copies, shared status/contract/storage boundary and request generation on reload/unmount.
Inspected shell/read/edit guards against the documented supported subset and host limitations.
The comparison uses real Git failures and includes both rename ends; tests now exercise a real rename.

All passed within the declared scope; no unresolved in-scope correctness finding. Remaining limits:
Vite warns about a future native config loader; current Vitest 5 tests/builds pass. Six dependency
advisories remain assessed/open, not suppressed. Native-device UI and live host registration of
Claude/Codex protection are not established by unit tests. Full runtime outcomes follow below.

## Verification

2026-09-27 — Inline verifier, Node 26.7.0 / pnpm 12.6.0, branch
`chore/platform-calidad-integral`. No commits or push. Local logs are ephemeral under `/tmp/rrhh-integral-*`;
this section preserves the decisive evidence.

- Baseline before implementation: `pnpm check` PASS; `pnpm test:integration` PASS (14 tests).
- Closing `pnpm check`: PASS, `18 successful, 18 total` Turbo tasks; 79 application/domain/client/
  frontend tests, 156 hook/plan/scope cases, 6 bootstrap cases and 9 effective config controls.
  Turbo may reuse unchanged package checks; this is suite evidence, not live-host enforcement.
- Architecture: `no dependency violations found (89 modules, 250 dependencies cruised)`.
- `pnpm test:integration`: `Test Files 2 passed (2)`, `Tests 16 passed (16)`, local `_test` database.
  Concurrent saves are actual Promise.all operations with persisted-count assertions.
- `pnpm harness:check`: `24 adaptadores al día`. Generated profiles updated only via harness:sync;
  skill outputs whose source text did not change remain unchanged. `scripts/plans/lib.mjs` needed
  no change: the existing parsePlan/declaredFiles exports suffice.
- `pnpm plans:scope ... --base main`: PASS, all 108 changed paths inside the plan (128 declared).
  Listed frontend files already compliant were intentionally untouched.
- Real API on localhost:3401 using the existing HTTP entry point and validated local `_test` URL:
  company create/list/duplicate returned 201/200/409; employee register/list/duplicate 201/200/409;
  invalid company input 400. Verified stable conflict codes, list shapes and ACTIVE status.
- Queried Prisma by this run's generated IDs: exactly one synthetic company and one synthetic
  employee. Updated only that company to inactive; web localhost:3400/empresas returned 200,
  displayed the synthetic company and Activa, then Inactiva. After stopping API, the page displayed
  the expected API-unavailable message. This was real server-rendered HTML, not a browser click test.
- Removed only those two seeded records using IDs plus fixture identity predicates; deletion counts
  were exactly one each. Stopped both servers started by this QA; existing user services untouched.
- `EXPO_NO_DOTENV=1 CI=1 pnpm --filter @rrhh/mobile exec expo export --platform android`: PASS,
  one Hermes Android bundle, `Exported: dist`. No native source edits.
- Direct guard process tests: inert quoted/nested payloads, malformed input, symlink destinations,
  secret path variants and harmless allow cases exercised. Denied fixture remained unchanged.

NOT VERIFIED / external limits:

- Device interactions, native browser/Alert/splash behavior and browser navigation were not exercised.
  Component/hook tests and Android bundle are not native UI E2E.
- Installed runtimes report Claude Code 2.1.283 and codex-cli 0.155.1. No additional agent session
  was launched (user requested all work inline). Live Claude hook registration, host sandbox access
  denial and model/profile availability were not tested. Codex does not run these Claude hooks.
  Do not infer runtime enforcement from 156 passing hook/plan tests.
- This host's normal tool sandbox failed at launch (`mountinfo path is not absolute`); approved
  scoped tool executions were used. That is an environment limitation, not a repository guarantee.
- Six dependency advisories remain open as assessed in docs/security/dependency-assessment.md.
  Current Vite emits a future native-config-loader warning; current tests and bundles pass.
- Node 24 CI and published production images were not executed here; local verification used Node 26.

Implementation and local verification are complete within these limits. Status remains verify:
only the user accepts external limits and moves the plan to done.
