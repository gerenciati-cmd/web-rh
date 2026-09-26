# Frontend conventions (apps/web, apps/mobile)

## Both

- **UI only**: no business rules, no database access. All data comes from the API through the
  typed client (`@rrhh/api-client`, instantiated in each app's `src/lib/api.ts`). Never
  hand-write `fetch` calls against the API or redeclare contract types.
- Form validation reuses the Zod schemas from `@rrhh/contracts` (same rule as the backend).
- Organize by feature: `src/features/<module>/{components,hooks}`; route files stay thin.
- Error handling uses `ApiError.code` (stable) to pick user-facing Spanish messages.
- **Your training data is outdated for these frameworks.** Read the installed docs:
  `apps/web/AGENTS.md` (Next 16) and `apps/mobile/AGENTS.md` (Expo SDK 57) before writing code.

## Web (Next.js 16, App Router)

- Server Components fetch via `@/lib/api`. Pages with live data call `await connection()` (or
  read cookies/headers) so they are not prerendered at build time.
- Presentational components receive data as props; they don't fetch.
- Tailwind 4 for styling.

## Mobile (Expo SDK 57, expo-router)

- Routes in `src/app/`; data hooks in `src/features/<module>/hooks/` handle loading/error states
  and cancellation.
- Native libraries: `pnpm --filter @rrhh/mobile exec expo install <lib>` (SDK-compatible
  versions). Never edit `ios/` or `android/` (generated).
- Secrets and tokens in `expo-secure-store`, never AsyncStorage.
- `EXPO_PUBLIC_*` variables are public by definition: never put secrets in them.
