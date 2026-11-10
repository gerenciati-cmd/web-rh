---
status: done
module: mobile
min_implementer: mid
depends_on: ['002', 'attendance-asistencia-diaria/005']
---

# 003 — Mi asistencia

## Context

After plan 002 the colaborador signs in, but **Inicio is a placeholder**: a "Próximamente" tile
(`apps/mobile/src/app/(app)/index.tsx:19-25`). The dock has two triggers, `index` → `/` and
`yo` → `/yo` (`apps/mobile/src/components/app-tabs.tsx:30-35`).

attendance-asistencia-diaria/005 adds two own-data routes:

- **`api.myAttendance.getMyAttendanceToday()`** returns
  `{ date, timeZone, shift: null | { id, name, day }, punches }`.
  - `day` is either `{ type: 'REST' }` or
    `{ type: 'WORK', scheduledStartAt, scheduledEndAt, scheduledMinutes, mealBreakMinutes, toleranceMinutes }`.
  - `punches` are ascending ISO instants inside today's window.
- **`api.myAttendance.listMyWorkdays({ query: { month } })`** returns `{ month, items }`.
  - `items` uses the staff `WorkdaySchema`: date, shiftName, status, scheduled start and end,
    first and last punch, lateMinutes, workedMinutes, overtimeMinutes…
  - Only the current or the previous month is allowed (`MONTH_NOT_AVAILABLE` otherwise).
- **Errors:** `ACCOUNT_NOT_LINKED` (staff account without a colaborador) and
  `EMPLOYEE_WITHOUT_SITE`.

**Decisions applied:**

- Attendance README decision 23: show everything, overtime included.
- Decision 24: current and previous month.
- Decision 25: today's shift and punches.
- Mobile README decision 2: the Caribe look — cyan for today and worked time, sand for rest,
  status colors with text, figures in Plex Mono.

**Chosen approach:**

- **Inicio becomes "Hoy":** today's shift and punches, read through `useMyToday`.
- **A new "Asistencia" tab** shows the month: an Actual/Anterior switch, summary tiles and the
  day list, read through `useMyWorkdays(month)`.
- **Display rules are pure functions** in `src/features/attendance/format.ts`, so they are
  unit-testable without a React Native renderer:
  - status → label and chip tone;
  - minutes → `8 h 05`;
  - an instant → `HH:mm` in the site zone;
  - the month summary.
- **Times are shown in the site's zone** from `today.timeZone`, never the phone's zone. The
  checador and the jornada rules work in the site zone. The workdays route does not return the
  zone, so the Asistencia screen reads `/today` first (`useMyToday`) and formats with its
  `timeZone`.

**Imitated files:**

- Data hooks follow the deleted-but-proven `useCompanies` pattern from plan 001: discriminated
  `State`, generation counter, `reload` (git history `apps/mobile/src/features/organization/hooks/use-companies.ts`;
  the shape is restated in step 3).
- Screens follow `src/app/(app)/index.tsx` and `src/app/(app)/yo.tsx`: `ShellHeader` +
  `ScrollView` + `useDockClearance`.

Load `expo:expo-overview`, `expo:expo-data-fetching` and `expo:expo-design-system` before coding.

## Out of scope

- Any API change (attendance 005).
- Punching from the phone (the checador is the source).
- Vacations and requests.
- Offline cache: a TanStack Query migration is a later plan.
- Push notifications.
- A provisional "late today" before the jornada closes (attendance 005, "Alternative
  rejected").
- More than the current and previous month.

## Dependencies

- **mobile-app-colaborador/002 (`done`):** `useSession`; the authenticated `api` client; the
  `(app)` group with Inicio and Yo; the UI components.
- **attendance-asistencia-diaria/005 (not `done`; the implementer waits):**
  - `api.myAttendance.getMyAttendanceToday`;
  - `api.myAttendance.listMyWorkdays`;
  - the types `MyTodayDto` (or `z.infer` of `MyTodaySchema`) and `WorkdayDto` from
    `@rrhh/contracts`;
  - the error codes `ACCOUNT_NOT_LINKED`, `EMPLOYEE_WITHOUT_SITE` and `MONTH_NOT_AVAILABLE`.

## Steps

1. **Pure display helpers**
   - Files: `apps/mobile/src/features/attendance/format.ts` (create), `apps/mobile/src/features/attendance/format.test.ts` (create, by the tester)
   - Do: export, with Spanish docblocks and no React Native import:
     - `formatMinutes(min: number): string`: `0` → `0 min`, `45` → `45 min`, `480` → `8 h`,
       `485` → `8 h 05`.
     - `formatLocalTime(iso: string, timeZone: string): string`: 24 h `HH:mm`, via
       `Intl.DateTimeFormat('es-MX', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })`.
     - `formatLocalDay(date: string): string`: `YYYY-MM-DD` → `Lun 10 nov`. Build it from the
       date parts as a calendar date (no time zone shift) with the `es-MX` short weekday and
       month, and capitalize the first letter.
     - `workdayStatusView(w: WorkdayDto): { label: string; tone: 'success' | 'warning' | 'danger' | 'sand'; detail: string | null }`:

       | Workday                       | Label                | Tone    | Detail               |
       | ----------------------------- | -------------------- | ------- | -------------------- |
       | `ATTENDED`, `lateMinutes > 0` | `Retardo {n} min`    | warning | —                    |
       | `ATTENDED`, `lateMinutes = 0` | `Asistencia`         | success | —                    |
       | `ABSENT_NO_PUNCHES`           | `Falta`              | danger  | `Sin marcaciones`    |
       | `ABSENT_SINGLE_PUNCH`         | `Falta`              | danger  | `Una sola marcación` |
       | `REST_WORKED`                 | `Descanso trabajado` | sand    | —                    |

       Use an exhaustive `switch` (the lint rule requires it).

     - `monthSummary(items: WorkdayDto[]): { attended: number; late: number; absences: number; overtimeMinutes: number; restWorked: number }`.
       - `attended` counts `ATTENDED`, including late ones.
       - `late` counts `ATTENDED` with `lateMinutes > 0`.
       - `absences` counts both `ABSENT_*`.
       - `overtimeMinutes` sums all items.
       - `restWorked` counts `REST_WORKED`.
     - `previousMonth(month: string): string`: `2026-01` → `2025-12`.
   - Observable result: unit-testable. Formatting `2026-11-10T13:56:00Z` in `America/Cancun`
     gives `08:56`.

2. **Error messages for attendance reads**
   - Files: `apps/mobile/src/features/attendance/attendance-error-message.ts` (create), `apps/mobile/src/features/attendance/attendance-error-message.test.ts` (create, by the tester)
   - Do: export `attendanceErrorMessage(error: unknown): string`:

     | Error                   | Message                                                                                |
     | ----------------------- | -------------------------------------------------------------------------------------- |
     | `ACCOUNT_NOT_LINKED`    | `Tu cuenta no está vinculada a un colaborador, así que no hay asistencia que mostrar.` |
     | `EMPLOYEE_WITHOUT_SITE` | `Aún no tienes sede asignada. Pide a RRHH que la registre.`                            |
     | `MONTH_NOT_AVAILABLE`   | `Solo puedes consultar el mes actual y el anterior.`                                   |
     | any other `ApiError`    | `No se pudo cargar tu asistencia ({code}).`                                            |
     | not an `ApiError`       | `No se pudo conectar. Revisa tu conexión e intenta de nuevo.`                          |

     A 401 never reaches here as a message: plan 002's `authFetch` signs the user out.

   - Observable result: unit-testable.

3. **Data hooks**
   - Files: `apps/mobile/src/features/attendance/hooks/use-my-today.ts` (create), `apps/mobile/src/features/attendance/hooks/use-my-workdays.ts` (create), `apps/mobile/src/features/attendance/hooks/use-my-today.test.tsx` (create, by the tester), `apps/mobile/src/features/attendance/hooks/use-my-workdays.test.tsx` (create, by the tester)
   - Do: both hooks return `{ state, reload }`, where `state` is `{ status: 'loading' } | { status: 'error'; message } | { status: 'success'; data }`.
     - They use a `mounted` ref and a `generation` counter so an older response never overwrites
       a newer one, and nothing is set after unmount.
     - `reload()` sets `loading` and fetches again.
     - Errors go through `attendanceErrorMessage`.
     - `useMyToday()` calls `api.myAttendance.getMyAttendanceToday()`.
     - `useMyWorkdays(month: string | null)` stays `loading` without fetching while `month` is
       `null`. It refetches when `month` changes, and the generation guard drops the previous
       month's late response.
   - Observable result: hook tests with a mocked `@/lib/api` (`vi.mock`, as in
     `src/features/identity/session/session-provider.test.tsx`).

4. **Inicio becomes "Hoy"**
   - Files: `apps/mobile/src/app/(app)/index.tsx` (modify)
   - Do: replace the placeholder tile. Keep `ShellHeader` with eyebrow `RRHH APS` and title
     `Hoy`, and add pull-to-refresh (`RefreshControl` calling `reload`).
     - **loading:** `AppText variant="caption" tone="ink2"` `Cargando tu día…`.
     - **error:** a `Tile` with the message (`tone="danger"`) and
       `Button variant="secondary" title="Reintentar"`.
     - **success**, with `data` as `today` and `tz = today.timeZone`:
       - **Shift tile:** `label` `Turno · {formatLocalDay(today.date)}`.
         - WORK: `figure` `{start}–{end}` via `formatLocalTime`, then caption
           `{shift.name} · {formatMinutes(scheduledMinutes)} · comida {mealBreakMinutes} min · tolerancia {toleranceMinutes} min`.
         - REST: `Chip` `Descanso` (`sand`), with caption `Hoy no tienes turno de trabajo.`
         - `shift === null`: caption `No tienes turno asignado hoy.`
       - **Punches tile:** `label` `Marcaciones de hoy`.
         - None: caption `Aún no registras marcaciones hoy.`
         - Otherwise: `figure` with the first punch as `Entrada {HH:mm}`. When there is more than
           one: `Última {HH:mm}` and a caption `{n} marcaciones`. Times in Plex Mono.
         - Below: caption `El retardo y las horas extra se calculan al cerrar el día.`
   - Observable result:
     - A colaborador with a shift sees today's scheduled times in the site zone and their
       punches.
     - A rest day shows "Descanso".
     - The staff admin sees the not-linked message.

5. **Asistencia tab and screen**
   - Files: `apps/mobile/src/app/(app)/asistencia.tsx` (create), `apps/mobile/src/components/app-tabs.tsx` (modify)
   - Do:
     - **Dock:** add a trigger `name="asistencia" href="/asistencia"` labeled `Asistencia`, with
       icon `{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }`, between
       Inicio and Yo. If the type rejects a name, use the closest Material Symbols name and
       record it in Deviations.
     - **Screen:** `ShellHeader` with eyebrow `Mi asistencia` and title equal to the month name
       in Spanish (`Noviembre 2026`). It uses `useMyToday` (for `timeZone` and the current
       month `today.date.slice(0, 7)`) and `useMyWorkdays(selected)`.
       - **Month switch:** a two-option segmented row, `Este mes` / `Mes anterior`. Each option
         is a `Pressable` with `accessibilityRole="button"` and `aria-selected` (plus
         `accessibilityState` on native, as plan 002 did for the switch row), min height 44.
         `selected` is `current` or `previousMonth(current)`.
       - **Summary bento:** a 2×2 grid of `Tile`s from `monthSummary`:
         - `Asistencias` (attended);
         - `Retardos` (late, warning-colored figure);
         - `Faltas` (absences, danger-colored figure);
         - `Horas extra` (`formatMinutes`), with caption `Medidas, sin autorizar`.

         Show `Descansos trabajados` only when it is greater than 0.

       - **Day list:** newest first. One row per item in a `Tile`:
         - `formatLocalDay(date)`;
         - `Chip` from `workdayStatusView` with its `detail` caption;
         - when punches exist, `{entrada}–{salida}` in mono via `formatLocalTime`;
         - caption `Trabajado {formatMinutes(workedMinutes)}`, plus
           ` · extra {formatMinutes(overtimeMinutes)}` when greater than 0.
       - **Empty month:** caption
         `No hay jornadas registradas este mes. Las jornadas aparecen cuando cierra cada día.`
       - **Loading and error:** as in Inicio. The screen also has pull-to-refresh.
   - Observable result:
     - The dock shows Inicio, Asistencia and Yo.
     - The month switch changes the list.
     - Counts in the summary match the list.
     - Times are in the site zone.

## Acceptance criteria

- [ ] `pnpm check` passes, and `expo export --platform android` bundles.
- [ ] Signed in as a colaborador (invited and activated, with RFC, sede and shift), Hoy shows:
  - today's shift times in the site zone (or Descanso, or no shift);
  - today's punches;
  - a correct state after pull-to-refresh.
- [ ] Asistencia lists the stored jornadas of this month, newest first:
  - status chips: Asistencia, Retardo N min, Falta (with its reason), Descanso trabajado;
  - entry–exit times in the site zone;
  - worked and overtime minutes.
- [ ] "Mes anterior" switches to the previous month. The summary counts equal the list.
- [ ] A month with no jornadas shows the empty message.
- [ ] The staff admin (`admin@example.com`, not linked) sees
      `Tu cuenta no está vinculada a un colaborador…` on both screens, not a crash.
- [ ] With the API down, both screens show the connection message, and "Reintentar" recovers.
- [ ] The dock has 3 tabs with `aria-selected` correct on web.

The verifier needs a colaborador test account. Admin or HR invites a seeded colaborador
(`ana.rojas@example.com` or `pedro.soto@example.com`, `apps/api/prisma/seed.ts:74, 82`). The
invitation email arrives in Mailpit (`localhost:8025`), and the user or the verifier activates it
with a test password generated in session. The colaborador needs RFC, sede, a shift assignment
and some punches or recalculated jornadas. That setup goes through the existing staff endpoints;
record exactly what was created.

## Test layers required

| Layer                 | Applies | Focus                                                                                                                                                                                                                                 |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain                | no      | No API change                                                                                                                                                                                                                         |
| application           | no      | No API change                                                                                                                                                                                                                         |
| contract              | no      | No contract change in this plan                                                                                                                                                                                                       |
| http                  | no      | No API change                                                                                                                                                                                                                         |
| integration           | no      | No persistence                                                                                                                                                                                                                        |
| mobile unit (pure TS) | yes     | `formatMinutes`, `formatLocalTime` (Cancún / CDMX, around midnight), `formatLocalDay`, `workdayStatusView` (every status, late vs on time), `monthSummary`, `previousMonth` (January), `attendanceErrorMessage` (every code, network) |
| mobile hook (jsdom)   | yes     | `useMyToday` and `useMyWorkdays`: loading → success/error; reload; month change refetches and drops the stale response; null month does not fetch; unmount guard                                                                      |
| e2e                   | no      | (no e2e infrastructure yet) Screens are checked by the verifier on Expo web and Expo Go                                                                                                                                               |

## Deviations

- **Step 1 (cosmetic):** added `formatMonthTitle(month)` to `format.ts` (`2026-11` → `Noviembre 2026`).
  Step 5 requires the Spanish month name in the header but no helper was listed; the tester should cover it.
- **Step 3 (cosmetic):** the hooks do not use a `mounted` ref plus a `generation` counter. The lint rule
  `react-hooks/set-state-in-effect` rejected that shape. They use an effect-local `cancelled` flag (covers
  unmount and stale responses) and an `attempt` counter for `reload`. `useMyWorkdays` derives `loading` when the
  stored result belongs to another month or attempt, so a `null` month never fetches and a stale month's response
  is dropped. Same observable behavior as the plan.
- **Step 3 (note for the tester):** `useMyToday.reload` sets `loading` itself. `useMyWorkdays.reload` only bumps
  the attempt; `loading` is derived.
- **Step 5 (environment):** `.expo/types/router.d.ts` is gitignored and only regenerates when Metro runs. The new
  `/asistencia` href failed `tsc` until `expo start` ran briefly (killed by timeout). A fresh clone or CI needs
  the same typegen before `typecheck`; `pnpm check` is green here.
- Dock icon `calendar_month` was accepted by the type; no change from the plan.
- Hoy shows `Entrada` and `Última` on two figure lines instead of one, because a single 24 pt mono line
  overflows a phone width.

## Test coverage

Layers applied: mobile unit (pure TS) and mobile hook (jsdom). Every other layer is "no" in the plan
table (no API, contract, persistence or e2e change). Baseline `pnpm check`: green. 50 tests added.

| Behavior (from plan / code)                                     | Source (`file:line`)                | Layer | Test                                                                         | State     |
| --------------------------------------------------------------- | ----------------------------------- | ----- | ---------------------------------------------------------------------------- | --------- |
| `formatMinutes`: 0, 45, 59, 60, 480, 485 (zero-padded)          | `format.ts:4`                       | unit  | `format.test.ts › formatMinutes`                                             | CONFIRMED |
| `formatLocalTime` in the site zone, 24 h, midnight `00:xx`      | `format.ts:15`                      | unit  | `format.test.ts › formatLocalTime` (Cancún, CDMX, midnight, crosses UTC day) | CONFIRMED |
| `formatLocalDay` capitalized, calendar date without zone shift  | `format.ts:25`                      | unit  | `format.test.ts › formatLocalDay`                                            | CONFIRMED |
| `formatMonthTitle` (deviation helper): Spanish month and year   | `format.ts:57`                      | unit  | `format.test.ts › formatMonthTitle`                                          | CONFIRMED |
| `workdayStatusView`: every status, late vs on time              | `format.ts:69`                      | unit  | `format.test.ts › workdayStatusView`                                         | CONFIRMED |
| `monthSummary`: counts, late inside attended, overtime sum      | `format.ts:93`                      | unit  | `format.test.ts › monthSummary`                                              | CONFIRMED |
| `previousMonth`, including January to December                  | `format.ts:121`                     | unit  | `format.test.ts › previousMonth`                                             | CONFIRMED |
| `attendanceErrorMessage`: three codes, other ApiError, non-Api  | `attendance-error-message.ts:4`     | unit  | `attendance-error-message.test.ts`                                           | CONFIRMED |
| `useMyToday`: loading → success / error; reload; stale; unmount | `hooks/use-my-today.ts:14`          | hook  | `use-my-today.test.tsx`                                                      | CONFIRMED |
| `useMyWorkdays`: null month no fetch; month change; stale month | `hooks/use-my-workdays.ts:20`       | hook  | `use-my-workdays.test.tsx`                                                   | CONFIRMED |
| Screens (Hoy, Asistencia), dock, pull-to-refresh rendering      | `index.tsx`, `asistencia.tsx`, dock | e2e   | none: no mobile e2e or native render infrastructure                          | verifier  |

Notes:

- Plan example `Lun 10 nov` is wrong for 2026: 2026-11-10 is a Tuesday, so the test asserts `Mar 10 nov`.
  The helper is correct (calendar-date based); only the plan's illustration was off.
- `useMyToday` stale-response test: the effect-local `cancelled` flag drops the older response after `reload`.
  The `generation` counter in the plan was replaced (see Deviations); the observable behavior is covered.
- No GAP and no NOT CONFIRMED items.

### Re-test after Review fixes (2026-11-10)

The two review fixes are JSX inside the screens, with no helper to extract:

| Behavior (from `## Review fixes`)                                              | Source (`file:line`)                        | Layer | Test                                                          | State    |
| ------------------------------------------------------------------------------ | ------------------------------------------- | ----- | ------------------------------------------------------------- | -------- |
| `punchCount === 1`: one time instead of `entrada–salida` in the Asistencia row | `asistencia.tsx:182` (inline conditional)   | e2e   | none: no native render infrastructure, no helper to unit-test | verifier |
| Hoy without punches shows `Sin marcaciones en la ventana de hoy.`              | `index.tsx` (inline text in `TodayContent`) | e2e   | none: same reason                                             | verifier |

- No layer covers them. `formatLocalTime`, `workdayStatusView` and the hooks are unchanged and
  already covered; a test that renders the screens or matches source text is not allowed by
  `testing.md` (forbidden antipattern 1; no render infrastructure). No test was added or touched.
- The verifier must check both on Expo web or Expo Go: a `ABSENT_SINGLE_PUNCH` day shows one
  time, and a day with no punches shows the neutral text.
- Closing `pnpm check`: green (format, typecheck, lint, tests, arch, plans:lint, harness checks,
  test:harness, test:bootstrap, test:quality). `pnpm test:integration` not needed: no
  `infrastructure/` or schema change.

## Review findings

Reviewer (subagente), 2026-11-10. Alcance: el trabajo sin commitear sobre `56504cf`
(`git diff 56504cf` + untracked `asistencia.tsx` y `src/features/attendance/`). Se excluyen
`apps/mobile/.gitignore` y `docs/referencia/`, que el despacho señaló como ajenos.

**Checklist: 13/13 aplicables en verde.** Status sigue en `review`: hay 1 hallazgo Low que pide
cambio de código.

- [x] Alcance: `pnpm plans:scope` contra origin/main sale en rojo (202 archivos), pero solo porque
      cuenta los commits previos de la rama (identity 007 y attendance 005, ambos `done`). Sobre
      `56504cf` cambiaron 10 archivos de producto o test más este plan, y los 10 están en la lista
      `Files:`. No se tocó ningún hot file.
- [x] `pnpm check` completo en verde de una sola pasada, corrido por el reviewer: format, turbo
      typecheck/lint/test, arch, plans:lint, harness:check, test:harness (161), test:bootstrap (17)
      y test:quality (9).
- [x] Integración: n/a, no se tocó `infrastructure/` ni el esquema.
- [x] Sin reglas de negocio en la UI: los helpers solo traducen el DTO a texto, y los totales del
      mes son conteos de presentación que el plan pidió.
- [x] CQRS: n/a, no hay cambios en el API.
- [x] Los tipos vienen de `@rrhh/contracts` (`MyTodayDto`, `MyWorkdaysDto`, `WorkdayDto`). Los
      datos pasan por `api.myAttendance.*` y no hay `fetch` escrito a mano.
- [x] Errores: se eligen por `ApiError.code`, y los códigos desconocidos caen al mensaje genérico
      con su código.
- [x] Fechas: los instantes se muestran en la zona de la sede (`today.timeZone`). El mes actual
      sale de `today.date` (zona de la sede), no de la zona del teléfono.
- [x] Migración: n/a.
- [x] DI: n/a en el API.
- [x] Sin secretos ni datos reales: los fixtures de los tests son sintéticos.
- [x] Deviations honestas. Comprobé una en el código: `useMyWorkdays.reload` solo sube `attempt` y
      el `loading` se deriva (`use-my-workdays.ts:48-50, 53-56`). La salvedad de tipos está en
      Info 3.
- [x] Docs: ningún doc describía el placeholder de Inicio ni el dock. No hay docs desactualizadas.

### High / Medium

Ninguno.

### Low

1. **Una falta por marcación única se muestra como si hubiera entrada y salida.**
   `apps/mobile/src/app/(app)/asistencia.tsx:179-184`.
   - El rango `{entrada}–{salida}` se pinta cuando `firstPunchAt` y `lastPunchAt` no son null.
   - Con `ABSENT_SINGLE_PUNCH`, el calculador asigna la misma marcación a ambos campos
     (`apps/api/src/modules/attendance/domain/workday-calculator.ts:158-159`).
   - Escenario: el colaborador marca solo a las 08:02 y el día cierra. La fila muestra
     `Falta · Una sola marcación` y debajo `08:02–08:02`, que parece una entrada y una salida.
   - Sigue el texto literal del plan ("when punches exist"), así que no es una desviación del
     implementer. Aun así es un fallo visible en una pantalla laboral.
   - Arreglo sugerido, a confirmar: con `punchCount === 1`, mostrar una sola hora (por ejemplo
     `Marcación 08:02`).

2. **Decisión del usuario; no bloquea por sí sola: turno nocturno en curso en Hoy.**
   `apps/mobile/src/app/(app)/index.tsx:85-90`.
   - La revisión de attendance-asistencia-diaria/005 dejó una nota para este plan
     (Review findings, Info). A las 02:00 de un turno 22:00–06:00 que empezó ayer,
     `/me/attendance/today` devuelve el turno de hoy y `punches: []`. La entrada de anoche
     pertenece a la ventana de ayer, que aún no tiene jornada guardada.
   - Escenario: un guardia nocturno abre Hoy a mitad de turno. Ve `22:00–06:00` y
     `Aún no registras marcaciones hoy.` Aunque marcó a las 21:55, en ninguna de las dos
     pantallas aparece prueba de su entrada.
   - El plan no menciona el caso, y el implementer siguió el plan.
   - Opciones:
     - (a) un texto más neutro cuando la ventana está vacía, por ejemplo
       `Sin marcaciones en la ventana de hoy. Si tu turno empezó ayer, su jornada aparecerá en Asistencia al cerrar.`;
     - (b) aceptarlo tal cual para la v1;
     - (c) un plan de API que exponga la ventana en curso (fuera del alcance de este plan).
   - Lo debe decidir el usuario o el arquitecto. No es un cambio que el implementer haga por su
     cuenta.

### Info (sin acción)

1. **Pull-to-refresh.** `RefreshControl refreshing={false}` hace que el spinner nativo termine al
   instante. El feedback es el texto de carga que reemplaza al contenido. Es aceptable, pero el
   verifier debe confirmar en Expo Go que no queda un spinner colgado en iOS.
2. **Recarga en Asistencia.** La recarga pasa `selected` a null mientras `today` vuelve a cargar,
   y después hace una sola consulta del mes. Lo leí en el código, sin probarlo: no hay doble
   petición y una respuesta vieja no pisa a la nueva.
3. **Typegen, no confirmado.** La Deviation de Step 5 dice que un clon nuevo o CI necesitan
   typegen antes de `typecheck`. Probablemente no es así:
   - sin `.expo/types/router.d.ts`, la interfaz `ExpoRouter.__routes` queda vacía y `Href` debería
     caer al modo laxo;
   - lo que falló aquí fue un `router.d.ts` local desactualizado, sin `/asistencia`.
     No lo probé en un clon limpio.
4. **Untracked de origen incierto.** `apps/mobile/.gitignore` es un archivo generado por expo-cli
   (cabecera `@generated expo-cli`) y quizás apareció cuando el implementer corrió `expo start`. El
   despacho lo marca como ajeno. No lo toqué: que lo decida el usuario.
5. **Formato de fechas en Hermes.** `Intl.DateTimeFormat` con `timeZone` y `formatToParts`
   (`format.ts:15-39`) solo tiene pruebas en Node. El verifier debe comprobar en Expo Go Android
   que se ven las horas en la zona de la sede y `Mar 10 nov`.

### Segunda ronda (2026-11-10, tras `## Review fixes`)

Reviewer (subagente). Alcance: solo los dos fixes de `## Review fixes`, la decisión 9 del README
y la subsección de re-test de `## Test coverage` (diff sin commitear sobre `56504cf`).

**Checklist: todo en verde.** No hay hallazgos nuevos. Status pasa a `verify`.

- [x] Alcance: los archivos cambiados siguen siendo los de la primera ronda (`index.tsx`,
      `asistencia.tsx`, `app-tabs.tsx`, `src/features/attendance/`), más este plan y el README
      de la serie. El diff del README solo agrega la decisión 9.
- [x] `pnpm check` completo en verde, corrido por el reviewer (turbo 19/19 tareas, test:quality 9/9).
- [x] Integración: n/a, sin cambios en `infrastructure/` ni en el esquema.
- [x] Low 1 resuelto (`apps/mobile/src/app/(app)/asistencia.tsx:178-183`): la fila pinta
      `formatLocalTime(firstPunchAt)` y agrega `–salida` solo si `punchCount > 1`. Un día
      `ABSENT_SINGLE_PUNCH` (con `punchCount === 1`, primera = última) muestra `08:02`. Con 2 o
      más marcaciones el rango no cambia. `punchCount` es un `int >= 0` del contrato
      (`workday.contract.ts:72`). Si las dos marcas son null, la fila no se pinta, igual que antes.
- [x] Low 2 resuelto según la decisión 9 (`apps/mobile/src/app/(app)/index.tsx:86-88`): con la
      ventana vacía el texto es `Sin marcaciones en la ventana de hoy.` y ya no afirma que la
      persona no marcó. Se eligió la opción (b) con copy neutro. La exposición del turno en curso
      desde el API queda para después, según el README; no requiere un hallazgo nuevo porque ya
      está registrada como decisión.
- [x] Re-test honesto: los dos cambios son JSX en línea, sin un helper que se pueda probar. La capa
      marcada es `verifier` y no se agregaron tests que lean texto del fuente. Esto es coherente
      con `testing.md`.
- [x] Sin secretos ni datos reales.

El verifier debe comprobar en la app: (1) un día con una sola marcación muestra una hora y no un
rango; (2) Hoy sin marcaciones muestra el texto neutro. También siguen pendientes los Info 1 y 5
de la primera ronda (spinner de iOS y `Intl` en Hermes).

## Review fixes

Reparación (2026-11-10) de los hallazgos de `## Review findings`, circuito de reparación de
`workflow.md`. La revisión y verificación previas no cubren este código y deben repetirse
(testing → review → verify).

- **Low 1** (`apps/mobile/src/app/(app)/asistencia.tsx`): con `punchCount === 1` la fila muestra una
  sola hora (`08:02`), ya no `08:02–08:02`. Con 2 o más marcaciones el rango no cambia.
- **Low 2** (`apps/mobile/src/app/(app)/index.tsx`, decisión 9 del README): el texto de Hoy sin
  marcaciones pasó de `Aún no registras marcaciones hoy.` a `Sin marcaciones en la ventana de hoy.`,
  neutro ante un turno nocturno en curso.
- Tests existentes: ninguno referencia ese texto ni el rango; no se tocó ninguno. El formato es JSX
  en la pantalla, sin helper; el tester decide si cubre `punchCount === 1`.

## Verification

Verifier (inline, sesión principal), 2026-11-10 (martes). Resultado: **PASS** en web; lo nativo
queda NOT VERIFIED (abajo).

- Suites: `pnpm check` verde en la segunda ronda de revisión, sin cambios de código después.
  `expo export --platform android` empaqueta (1781 módulos, bundle Hermes de 4.5 MB).
- App corriendo:
  - Expo web en `:8081` con `EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1` en la línea de
    comandos;
  - API y worker de desarrollo en `:3000`;
  - Chrome a 420 px de ancho, en modo oscuro.
- Cuenta: colaboradora sembrada `ana.rojas@example.com`, activada en la verificación de
  identity-acceso/007 con una contraseña de prueba generada en sesión. Sus datos se crearon en la
  verificación de attendance-asistencia-diaria/005:
  - sede Cancún Centro;
  - turno "Oficina 9 a 18", asignado desde 2026-10-01;
  - 16 marcaciones por `/iclock`;
  - jornadas recalculadas del 2026-10-01 al 2026-11-09.
- Los estados que los datos reales no producen se simularon envolviendo `window.fetch` en la
  página, solo para `/me/attendance/*`: API caída, 422 `ACCOUNT_NOT_LINKED`, mes vacío, descanso
  y sin turno. Las pantallas se volvieron a montar cerrando sesión y entrando de nuevo, sin
  recargar la página.

Criterios de aceptación:

- [x] `pnpm check` pasa y `expo export --platform android` empaqueta.
- [x] **Hoy.**
  - Muestra "Turno · Mar 10 nov", `09:00–18:00` y "Oficina 9 a 18 · 8 h · comida 60 min ·
    tolerancia 10 min", en la hora de Cancún.
  - Marcaciones de hoy: "Entrada 08:57".
  - Descanso (simulado): "Descanso / Hoy no tienes turno de trabajo."
  - Sin turno (simulado): "No tienes turno asignado hoy."
  - Sin marcaciones (Low 2): "Sin marcaciones en la ventana de hoy."
  - Pull-to-refresh: NOT VERIFIED en web, porque `RefreshControl` no actúa ahí. El "Reintentar"
    usa la misma recarga y sí devuelve el estado correcto.
- [x] **Asistencia, este mes (noviembre 2026).**
  - Siete días, del más nuevo al más antiguo.
  - Chips: Asistencia, Descanso trabajado, y Falta con su motivo ("Sin marcaciones", "Una sola
    marcación").
  - Rangos de entrada y salida en la hora de Cancún.
  - "Trabajado 9 h 30 · extra 1 h 30" el 2 de noviembre.
  - Un día con una sola marcación muestra solo `09:01`, sin rango (Low 1).
- [x] **"Mes anterior"** cambia a Octubre 2026: 2 asistencias, 1 retardo, 20 faltas y 7 min extra,
      con "Retardo 22 min" el 30 de octubre. El resumen de noviembre coincide con la lista:
  - 4 asistencias (días 2, 5, 6 y 9);
  - 0 retardos (el 5 entró a las 09:05, dentro de la tolerancia);
  - 2 faltas;
  - 5 h 46 extra (90 + 15 + 240 + 1 min);
  - 1 descanso trabajado.
- [x] **Mes sin jornadas** (simulado): el resumen queda en ceros y aparece "No hay jornadas
      registradas este mes. Las jornadas aparecen cuando cierra cada día." Al volver a "Este mes" se
      recupera.
- [x] **Cuenta no vinculada**: "Tu cuenta no está vinculada a un colaborador, así que no hay
      asistencia que mostrar." en las dos pantallas, sin crash. Se simuló el 422 con el código real.
      No se entró como `admin@example.com` porque su contraseña vive en `.env`, que no se lee. El 422
      real del API está verificado en attendance 005 por los tests http.
- [x] **API caída**: "No se pudo conectar. Revisa tu conexión e intenta de nuevo." con
      "Reintentar" en Hoy y en Asistencia, y "Reintentar" recupera los datos en las dos pantallas.
- [x] **Dock**: 3 pestañas `role=tab` (Inicio, Asistencia, Yo), con `aria-selected` que sigue a
      la pantalla activa.
- Consola sin errores durante la sesión.

NOT VERIFIED (necesita Expo Go en un dispositivo):

- Spinner de pull-to-refresh en iOS (Info 1 de la revisión).
- `Intl` con `timeZone` y `formatToParts` bajo Hermes en Android (Info 5).
