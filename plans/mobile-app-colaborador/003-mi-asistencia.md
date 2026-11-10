---
status: approved
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

## Test coverage

## Review findings

## Verification
