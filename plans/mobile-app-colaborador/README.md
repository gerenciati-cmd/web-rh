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

| Plan | Title                       | Depends on                            | Purpose                                                                                                                                    |
| ---- | --------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 001  | "Caribe" theme and base UI  | —                                     | Tokens (light/dark), IBM Plex Sans/Mono, `AppText`/`Tile`/`Chip`/`Button`/`ShellHeader`, dark floating dock, Inicio and Empresas restyled. |
| 002  | Login (not written)         | 001, identity-acceso/001              | Login screen, Bearer token in `expo-secure-store`, logout. Covers the mobile half of identity-acceso 004.                                  |
| 003  | My attendance (not written) | 002, attendance-asistencia-diaria/002 | The colaborador's jornada of today and the month (entry, retardo, falta, descanso, horas extra) read from the API.                         |

## Dependency notes

- 001 touches only `apps/mobile`, with no API or contract change, so it can start at once.
- 002 builds its screens with 001's components.
- 003 needs a signed-in user (002). Open question for 003, to be checked in recon when it is
  written: identity-acceso decision 13 says the Colaborador role grants nothing until its data
  exists. Plan 003 must confirm which endpoint and permission let colaboradores read their own
  jornadas. If none exists, an API plan comes first.

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

## Delivered

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
