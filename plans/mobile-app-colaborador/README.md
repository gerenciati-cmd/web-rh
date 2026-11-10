# mobile-app-colaborador — Mobile app for the colaborador

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status mobile-app-colaborador`. -->

## Goal

Turn the Expo template in `apps/mobile` into the first usable screens of the RRHH app, mobile
first. The series has three steps:

1. Give the app the chosen visual identity ("Caribe" theme: tokens, IBM Plex fonts, base
   components, dark floating dock).
2. Let a person sign in with their account.
3. Show the colaborador their own daily attendance (jornada) from the API.

The web app adopts the same identity later, in its own series.

## Plans

| Plan                        | Title                                             | Depends on                            | Purpose                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 001                         | "Caribe" theme and base UI                        | —                                     | Tokens (light/dark), IBM Plex Sans/Mono, `AppText`/`Tile`/`Chip`/`Button`/`ShellHeader`, dark floating dock, Inicio and Empresas restyled.                                                             |
| 002                         | [Mobile login and session](002-login-y-sesion.md) | 001, identity-acceso/001              | Login screen with "Recordarme", session in `expo-secure-store`, protected routes, expired-session handling, "Yo" tab with logout; Empresas tab removed. Covers the mobile half of identity-acceso 004. |
| [003](003-mi-asistencia.md) | Mi asistencia                                     | 002, attendance-asistencia-diaria/005 | Inicio becomes "Hoy" (today's shift and punches) and a new Asistencia tab lists this or last month's jornadas with a summary; times in the site zone.                                                  |

## Dependency notes

- 001 touches only `apps/mobile`, with no API or contract change, so it can start at once.
- 002 builds its screens with 001's components.
- 003 needs a signed-in user (002) and the own-data API: identity-acceso/007 (`Actor.employeeId`, the
  `attendance.workdays:read-own` permission for EMPLOYEE), then attendance-asistencia-diaria/005
  (`/me/attendance/workdays` and `/me/attendance/today`). Order: identity 007 → attendance 005 →
  mobile 003.

## Decisions with the user

1. (2026-11-10) Order of work: theme first, then login, then attendance. Mobile first; the web app
   follows later.
2. (2026-11-10) Visual direction "Caribe" (proposal 3, artifact
   `https://claude.ai/artifact/G3jzFozEYzwJxe84cEETFL`). The look is minimal bento, data first,
   and must not copy the existing APS mobile app. Colors:
   - warm paper workspace;
   - dark petrol frame (`#0A2226`) for the header and a floating dock;
   - petrol `#004750` for the one primary action per screen;
   - cyan `#36B0C9` for signals (worked time, today, selection), never as text on light
     backgrounds;
   - sand for time off.
3. (2026-11-10) Typography: IBM Plex Sans for text, IBM Plex Mono for figures and times.
4. (2026-11-10) Rejected directions: generic indigo/violet palettes, and a navy+teal proposal
   that looked copied from the current APS mobile app (Manrope, cool grays, very round cards).
5. (2026-11-10) Session persistence uses a **"Recordarme" checkbox**. Checked: the session is
   kept on the device until logout or expiry (30 days, identity-acceso decision 5). Unchecked:
   it lives only while the app process runs.
6. (2026-11-10) The **Empresas tab is removed** from the mobile app. It was a demo screen, it
   only works for RRHH/Admin, and `/auth/me` does not return roles. The app focuses on the
   colaborador; empresas are managed from the web.
7. (2026-11-10) **"¿Olvidaste tu contraseña?" is not in plan 002.** The API sends the email,
   but its link needs a screen to set the new password, which exists nowhere yet. The full
   reset flow (request + link screen) is a later plan.
8. (2026-11-10) Logout and the user's data go in a new **"Yo" tab** in the dock. The
   colaborador profile grows there later.
9. (2026-11-10) **Night shift in progress on Hoy** (plan 003 review, Low 2): at 02:00 on a
   22:00–06:00 shift that started yesterday, `/me/attendance/today` does not return that shift's
   punches. For v1, Hoy's empty-punches copy is neutral and does not claim the person has not
   punched; exposing the shift in progress from the API is left for later.

## Delivered

- **"Caribe" theme and base UI** (001): tokens, IBM Plex, base components, dark floating dock.
- **Login and session** (002): "Recordarme", protected routes, expired-session handling, Yo tab.
- **Mi asistencia** (003): Hoy (today's shift and punches) and the Asistencia tab (this or last
  month's jornadas with a summary), in the site's time zone.

## Considered and discarded

- **Shared design-token package for web and mobile in plan 001**: discarded for now. The user
  chose mobile first (decision 1), and a package in `packages/` is cross-module (`platform`)
  work. The tokens live in `apps/mobile/src/constants/tokens.ts` as plain TS with no React Native
  import, so the web series can move them into a package unchanged.
- **Embedding fonts with the `expo-font` config plugin**: it needs a development build and does
  not work in Expo Go, and on iOS it uses PostScript family names instead of the file names.
  Plan 001 loads fonts at runtime with `useFonts`.
- **Restyling the native tab bar (`NativeTabs`)**: on iOS 26 the system draws the bar with
  Liquid Glass and ignores `backgroundColor`, so the dark dock of the design cannot be built
  with it. Plan 001 uses the headless `expo-router/ui` tabs instead.
