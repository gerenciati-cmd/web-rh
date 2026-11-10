---
status: done
module: mobile
min_implementer: mid
depends_on: ['001', 'identity-acceso/001']
---

# 002 — Mobile login and session

## Context

The app built in plan 001 has no login. Every API call goes out anonymously:

- `apps/mobile/src/lib/api.ts:7-10` passes `getAccessToken: () => null`, with a
  `TODO(identity)` asking to read the token from `expo-secure-store`.
- Every `/api/v1` endpoint except login requires a session (verified in plan 001: `GET
/companies` returns `401 AUTHENTICATION_REQUIRED`).

The API side of login already exists and is `done` (identity-acceso/001).

**Login.** `POST /auth/login` (`packages/contracts/src/identity/auth.contract.ts:45-62`)
takes `{ email, password, client }`, where `client` is `'web' | 'mobile'` (line 5 and lines
19-30).

- It returns `{ user: { id, email, employeeId | null }, expiresAt, token }` (lines 8-14, 33-42).
- `token` is a string only for `client: 'mobile'`.
- Listed errors: `INVALID_CREDENTIALS` and `LOGIN_TEMPORARILY_BLOCKED` (line 58).

**Logout and me.**

- `POST /auth/logout` is authenticated and returns 204 (lines 63-77).
- `GET /auth/me` returns the same `SessionUser` (lines 78-89). It carries **no roles**, which
  is why the Empresas tab goes away (README decision 6).

**api-client** (`packages/api-client/src/client.ts`):

- It reads the token on **every call** through the optional `getAccessToken` (lines 17, 64) and
  sends `Authorization: Bearer …` (line 71).
- `fetch` is injectable (lines 19, 58).
- Non-2xx responses throw `ApiError` with `status` and `code` (lines 76, 105-110).
- Network failures throw the raw fetch error, not `ApiError`.

**Behavior reported by the read-only identity recon this session.** These are API facts the
plan relies on but does not change; the implementer does not need these files.

- An expired, revoked or unknown bearer token gets `401 AUTHENTICATION_REQUIRED`.
- A wrong password and a disabled user both get `401 INVALID_CREDENTIALS`.
- Throttling gets `429 LOGIN_TEMPORARILY_BLOCKED` with `details.retryAfterSeconds`.
- A malformed email gets `400 VALIDATION_ERROR` (identity-acceso decision 10).
- Mobile sessions last 30 days with no idle expiry (identity-acceso decision 5).

**Mobile app today (after plan 001):**

- `src/app/_layout.tsx:49-72` loads the fonts, then renders `ThemeProvider`,
  `AnimatedSplashOverlay` and `AppTabs`. `preventAutoHideAsync()` runs at module scope (lines
  21-23), and `AnimatedSplashOverlay` hides the native splash on its first layout.
- `src/components/app-tabs.tsx:24-40` has two headless `expo-router/ui` triggers: `index` → `/`
  and `empresas` → `/empresas`. `DockButton` is at lines 67-92.
- `src/app/empresas.tsx` and `src/features/organization/hooks/use-companies.ts:1-61` (with its
  test) exist only for the Empresas tab, which is being removed.
- `expo-secure-store` is not installed (`apps/mobile/package.json`).

**Expo docs read this session:**

- **Route protection.** Expo Router protects routes with `Stack.Protected` and its `guard`
  prop (docs `router/advanced/authentication` and `protected`). The installed expo-router
  ships it in `build/layouts/StackClient.d.ts`.
  - When a guard turns false, the user is redirected to the first available screen and that
    history is removed.
  - The docs recommend a session context with `isLoading`, keeping the splash up until it
    resolves.
  - The `redirectTo` prop is SDK 58+, so it is **not** used.
- **`expo-secure-store`** (docs v57):
  - API: `getItemAsync`, `setItemAsync`, `deleteItemAsync`.
  - Platforms: android, ios and Expo Go. **Not web.**
  - Keys: alphanumerics plus `.`, `-`, `_`.

**Chosen approach.**

- **Navigation.** The root `_layout` becomes a `Stack` with two guards: `(app)` (the tabs)
  when signed in, and `login` when not.
- **Session state.** A `SessionProvider` owns the session and keeps rendering `null` (so the
  splash stays) until the stored session is restored. The token lives in a small module store
  that `lib/api.ts` reads through `getAccessToken`.
- **Expired sessions.** A wrapped `fetch` reports any `401` on a request that **carried** a
  bearer token, and the provider signs the user out with a notice. Login itself never sends a
  token, so its own 401 (`INVALID_CREDENTIALS`) is not mistaken for an expiry.
- **Restore.** On start, a remembered session is restored immediately, so the app works offline
  with the stored user. It is then confirmed in the background with `/auth/me`.
- **Web.** The web build is dev-only, and SecureStore does not exist there. The session is never
  persisted on web: always in memory, and not in `localStorage` (unlike the docs example),
  because a long-lived bearer token must not sit in web storage.

**Alternatives rejected:**

- Checking `ApiError.status === 401` in every hook. That needs every screen's cooperation and
  is easy to forget.
- An Axios-style interceptor inside `@rrhh/api-client`. That is a cross-module package change;
  the injectable `fetch` already allows it from the app.

**README decisions applied:**

- Decision 5: the "Recordarme" checkbox. Unchecked, the token is kept only in memory. The
  server session is not revoked when the app is killed, so it simply expires after 30 days. That
  is accepted, because the token itself is gone from the device.
- Decision 6: the Empresas tab is removed.
- Decision 7: no password reset in this plan.
- Decision 8: the "Yo" tab holds the user's data and logout.

**Files imitated:**

- Screens follow `src/app/index.tsx` from plan 001: `ShellHeader` + `ScrollView` +
  `useDockClearance`.
- Hook tests follow `src/features/organization/hooks/use-companies.test.tsx:1-27`
  (`vi.mock('@/lib/api')`, `renderHook`).

**Before writing code, load the `expo:expo-overview`, `expo:expo-router` and
`expo:expo-design-system` skills.**

## Out of scope

- Password reset, account activation and changing the password (README decision 7;
  identity-acceso decision 29).
- Roles in `/auth/me`, and any API or contract change.
- Biometric unlock (`requireAuthentication`) and PIN.
- The web app's login (`apps/web`).
- Offline queueing and token refresh: the API has no refresh tokens (identity-acceso decision 4).
- Restyling plan 001 components beyond what the steps name.
- Deleting other template leftovers.

## Dependencies

- **mobile-app-colaborador/001 (`done`):**
  - `AppText`, `Tile`, `Chip`, `Button`, `ShellHeader` in `src/components/ui/`;
  - `usePalette` and `useDockClearance` in `src/hooks/use-palette.ts`;
  - tokens in `src/constants/theme.ts`;
  - the dock in `src/components/app-tabs.tsx`.
- **identity-acceso/001 (`done`):** `api.identity.logIn`, `api.identity.logOut` and
  `api.identity.me` with the shapes cited in Context.

## Steps

1. **Install SecureStore**
   - Files: `apps/mobile/package.json` (modify), `pnpm-lock.yaml` (modify), `apps/mobile/app.json` (modify, plugin added by expo install)
   - Do: `pnpm --filter @rrhh/mobile exec expo install expo-secure-store`.
   - Observable result: `expo-secure-store` is in `dependencies`, and
     `pnpm install --frozen-lockfile` passes.

2. **Session store: token in memory plus optional device persistence**
   - Files: `apps/mobile/src/features/identity/session/session-store.ts` (create), `apps/mobile/src/features/identity/session/session-store.test.ts` (create, by the tester)
   - Do: Spanish docblocks. Export:
     - `type StoredSession = { token: string; user: SessionUser; expiresAt: string }`, with
       `SessionUser` imported as a type from `@rrhh/contracts`.
     - `getCurrentToken(): string | null`: synchronous, reads a module-level variable.
     - `setCurrentSession(session: StoredSession | null)`: sets the module variable only.
     - `persistSession(session: StoredSession): Promise<void>`: on native, `setItemAsync`
       with key `'rrhh.session'` and `JSON.stringify(session)`. On web
       (`Platform.OS === 'web'`) it does nothing.
     - `loadPersistedSession(): Promise<StoredSession | null>`: native only (web returns `null`).
       - Reads the key and parses JSON.
       - Returns `null` and deletes the key if the JSON is invalid, a field is missing, or
         `Date.parse(expiresAt) <= Date.now()`.
     - `deletePersistedSession(): Promise<void>`: `deleteItemAsync` on native; nothing on web.

     Never log the token.

   - Observable result: typecheck passes. The module does not import `@/lib/api`.

3. **Fetch wrapper that reports expired sessions**
   - Files: `apps/mobile/src/features/identity/session/auth-fetch.ts` (create), `apps/mobile/src/features/identity/session/auth-fetch.test.ts` (create, by the tester)
   - Do: export:
     - `setUnauthorizedHandler(handler: (() => void) | null)`: a module-level variable.
     - `authFetch: typeof fetch`. It calls the global `fetch(input, init)`, resolved at call
       time. If the response status is `401` **and** `init?.headers` contains an
       `Authorization` header (case-insensitive, for plain-object headers as built by
       `client.ts:68-72`), it calls the handler. It always returns the response unchanged.
   - Observable result: the tester can show that a 401 with Authorization calls the handler,
     and that a 401 without it (login) or a 200 does not.

4. **Wire the api client to the session**
   - Files: `apps/mobile/src/lib/api.ts` (modify)
   - Do: keep `baseUrl` as is. Set `getAccessToken: getCurrentToken` and `fetch: authFetch`.
     Remove the `TODO(identity)` line and keep the docblock.
   - Observable result: after sign-in, every API call carries `Authorization: Bearer <token>`.

5. **Login error messages**
   - Files: `apps/mobile/src/features/identity/login-error-message.ts` (create), `apps/mobile/src/features/identity/login-error-message.test.ts` (create, by the tester)
   - Do: export `loginErrorMessage(error: unknown): string`, a pure function. Messages in
     Spanish:

     | Error                                  | Message                                                       |
     | -------------------------------------- | ------------------------------------------------------------- |
     | `ApiError` `INVALID_CREDENTIALS`       | `Correo o contraseña incorrectos.`                            |
     | `ApiError` `LOGIN_TEMPORARILY_BLOCKED` | `Demasiados intentos. Intenta de nuevo en {n} min.`           |
     | `ApiError` `VALIDATION_ERROR`          | `Escribe un correo y una contraseña válidos.`                 |
     | any other `ApiError`                   | `No se pudo iniciar sesión ({code}).`                         |
     | not an `ApiError` (network)            | `No se pudo conectar. Revisa tu conexión e intenta de nuevo.` |

     For the blocked case, `n = Math.max(1, Math.ceil(details.retryAfterSeconds / 60))` when
     `details.retryAfterSeconds` is a finite number. Otherwise use
     `Demasiados intentos. Intenta de nuevo en unos minutos.`

   - Observable result: unit-testable with no React Native import.

6. **Session provider**
   - Files: `apps/mobile/src/features/identity/session/session-provider.tsx` (create), `apps/mobile/src/features/identity/session/session-provider.test.tsx` (create, by the tester)
   - Do: export `SessionProvider` (children) and `useSession()`, which returns
     `{ status: 'loading' | 'signedOut' | 'signedIn'; user: SessionUser | null; notice: 'expired' | null; signIn(email, password, remember): Promise<void>; signOut(): Promise<void> }`.
     `useSession` throws a Spanish `Error` when used outside the provider.
     - **On mount:**
       1. Register `setUnauthorizedHandler`, which clears the session: `setCurrentSession(null)`,
          `deletePersistedSession()`, `status = 'signedOut'`, `user = null`,
          `notice = 'expired'`.
       2. `loadPersistedSession()`. With none, `status = 'signedOut'`. With one,
          `setCurrentSession(stored)`, `status = 'signedIn'`, `user = stored.user`. Then call
          `api.identity.me()` in the background: success updates `user` (and, if remembered,
          re-persists it with the new user); an `ApiError` 401 is already handled by the
          handler; any other error is ignored (offline keeps the stored user).
       3. On unmount, unregister the handler (`setUnauthorizedHandler(null)`).
     - **`signIn`:**
       - Calls `api.identity.logIn({ body: { email: email.trim(), password, client: 'mobile' } })`.
       - If `token` is `null`, it throws `new Error('El API no devolvió el token de sesión')`.
         That is unexpected, so the login screen shows the generic message.
       - Builds the `StoredSession`, calls `setCurrentSession`, then
         `remember ? persistSession : deletePersistedSession`.
       - Sets `user`, `status = 'signedIn'` and `notice = null`.
       - Errors propagate to the caller.
     - **`signOut`:** calls `api.identity.logOut()` and ignores any error, because the local
       sign-out must always happen. Then it clears exactly like the handler, except
       `notice = null`.
   - Observable result: the tester can drive restore, sign-in (remember true/false), sign-out
     and expiry with mocked `@/lib/api`, `session-store` and `auth-fetch`.

7. **Text field component**
   - Files: `apps/mobile/src/components/ui/text-field.tsx` (create)
   - Do: export `TextField`, with props `TextInputProps & { label: string; error?: string | null; secureToggle?: boolean }`.
     - **Layout:** a visible label (`AppText variant="label"`), a `TextInput`, and the error
       below it (`AppText variant="caption" tone="danger"`). Set `accessibilityLabel={label}`
       on the input.
     - **Input:** `minHeight: 48`, `RADIUS.md`, `borderCurve: 'continuous'`, 1 px border (`line`,
       or `danger` when there is an error), background `surface`, text `ink`, placeholder color
       `ink3`, `fontFamily: FONT_FAMILY.sans.regular`, `fontSize: 16` (16 avoids iOS zoom on
       web), padding horizontal 12.
     - **`secureToggle`:** the input becomes `secureTextEntry`, with a trailing pressable text
       `Mostrar`/`Ocultar` (`accessibilityRole="button"`, min 44×44 hit area) that toggles it.
     - Merge the caller's `style` last.
   - Observable result: typecheck and lint pass; used in step 9.

8. **Root navigation with guards; move the tabs under `(app)`**
   - Files: `apps/mobile/src/app/_layout.tsx` (modify), `apps/mobile/src/app/(app)/_layout.tsx` (create), `apps/mobile/src/app/(app)/index.tsx` (create), `apps/mobile/src/app/index.tsx` (delete), `apps/mobile/src/app/empresas.tsx` (delete), `apps/mobile/src/features/organization/hooks/use-companies.ts` (delete), `apps/mobile/src/features/organization/hooks/use-companies.test.tsx` (delete), `apps/mobile/src/components/app-tabs.tsx` (modify), `scripts/quality/frontend-config.test.mjs` (modify, lint fixture path moves to the new Inicio route)
   - Do:
     - **Root `_layout.tsx`:** keep the font loading and nav themes. Render `ThemeProvider` →
       `SessionProvider` → a `RootNavigator` component in the same file (not exported).
       `RootNavigator`:
       - returns `null` while `status === 'loading'` (the native splash stays);
       - otherwise renders `AnimatedSplashOverlay` plus
         `<Stack screenOptions={{ headerShown: false }}>`, with
         `<Stack.Protected guard={status === 'signedIn'}><Stack.Screen name="(app)" /></Stack.Protected>`
         and
         `<Stack.Protected guard={status !== 'signedIn'}><Stack.Screen name="login" /></Stack.Protected>`.

       `Stack` comes from `expo-router`.

     - **`(app)/_layout.tsx`:** default export rendering `<AppTabs />`.
     - **`(app)/index.tsx`:** the plan 001 Inicio content, without the "Ver empresas"
       `Link`/`Button` and its imports. The tile caption becomes
       `Aparecerán aquí muy pronto.`
     - **Delete:** `src/app/index.tsx`, `src/app/empresas.tsx`, `use-companies.ts` and its test.
       After this nothing references them.
     - **`app-tabs.tsx`:** keep the `index` → `/` trigger. Replace the `empresas` trigger with
       `name="yo" href="/yo"` labeled `Yo`, icon
       `{ ios: 'person.crop.circle', android: 'person', web: 'person' }`. Remove
       `COMPANIES_ICON`. If the type rejects a symbol name, use the closest Material Symbols
       name and record it in Deviations.
   - Observable result:
     - Signed out, any deep link lands on `login`. Signed in, the dock shows Inicio and Yo.
     - `grep -rn "empresas\|useCompanies" apps/mobile/src` returns nothing.

9. **Login screen**
   - Files: `apps/mobile/src/app/login.tsx` (create)
   - Do: default export. Background `paper`, then a `ShellHeader` with eyebrow `RRHH APS` and
     title `Inicia sesión`.
     - **Body:** a `ScrollView` with `keyboardShouldPersistTaps="handled"`, padding 16, gap 12,
       wrapped in `KeyboardAvoidingView` (`behavior="padding"` on iOS).
     - **Expired notice:** when `useSession().notice === 'expired'`, a `Tile tone="sunk"` on top
       with `AppText variant="bodyStrong"` `Tu sesión terminó` and caption
       `Vuelve a iniciar sesión para continuar.`
     - **Fields:**
       - Email `TextField` (label `Correo`, `keyboardType="email-address"`,
         `autoCapitalize="none"`, `autoComplete="email"`, `textContentType="username"`).
       - Password `TextField` (label `Contraseña`, `secureToggle`, `autoComplete="password"`,
         `textContentType="password"`).
       - A `Recordarme` row: RN `Switch` with track color `primary` when on, plus its
         `AppText` label; the whole row is pressable and toggles it. The switch starts off.
     - **Button:** primary, `title="Entrar"`, `loading` while signing in. It is disabled when
       the email or the password is empty after trimming the email.
     - **On submit:** call `signIn(email, password, remember)`. On error, show
       `loginErrorMessage(error)` in a danger `AppText` above the button, linked with
       `accessibilityLiveRegion="polite"` on native and `aria-live="polite"` on web. Keep the
       typed email and clear the password.
     - No navigation call is needed: the guard redirects once `status` becomes `signedIn`.
   - Observable result: with valid credentials the user lands on Inicio. With a wrong password
     they see `Correo o contraseña incorrectos.`

10. **"Yo" screen**
    - Files: `apps/mobile/src/app/(app)/yo.tsx` (create)
    - Do: default export.
      - **Header:** `ShellHeader` with eyebrow `Mi cuenta` and title `Yo`, then a `ScrollView`
        like Inicio (padding 10, gap 8, `paddingBottom: useDockClearance()`).
      - **Account tile:** `Tile` with `AppText variant="label"` `Correo`, then
        `AppText variant="bodyStrong"` `{user.email}`. Under it, when `user.employeeId` is
        `null`, a caption `Tu cuenta no está vinculada a un colaborador.`
      - **Logout:** `Button variant="secondary" title="Cerrar sesión"` with `loading` while
        `signOut()` runs.
    - Observable result: tapping "Cerrar sesión" returns to the login screen. The API session is
      revoked (`/auth/me` with the old token returns 401).

## Acceptance criteria

- [ ] `pnpm check` passes, and `expo export --platform android` bundles.
- [ ] Signed out, opening the app (or `/`, `/yo`) shows the login screen. No tab is reachable.
- [ ] A wrong password shows `Correo o contraseña incorrectos.` and keeps the email.
- [ ] Repeated failures up to the throttle show `Demasiados intentos. Intenta de nuevo en N min.`
- [ ] With the API down, login shows the connection message.
- [ ] Valid credentials land on Inicio, and the dock shows Inicio and Yo. "Yo" shows the email.
- [ ] Every later API request carries `Authorization: Bearer` (check the network panel on web).
- [ ] "Cerrar sesión" returns to login, and the old token now gets 401 from `/auth/me`.
- [ ] Session revoked or expired while signed in (for example, logout from another client with
      the same token, or session revoked in the DB by the verifier on the dev DB): the next API
      call returns the user to login with "Tu sesión terminó".
- [ ] Native (Expo Go), "Recordarme" on: after killing and reopening the app, the user is
      still signed in. With it off, the user must sign in again. On web the session never
      survives a reload; that is expected (see Context).
- [ ] The Empresas tab and screen no longer exist.

Test account: the dev seed creates `admin@example.com` only when `SEED_USER_PASSWORD` is set
(`apps/api/prisma/seed.ts:120-129`). The verifier must not read `.env`. Either the user signs in
during verification, or the user provides a dev test account in chat.

## Test layers required

| Layer                 | Applies | Focus                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain                | no      | No API change                                                                                                                                                                                                                                                                                                                                                                                               |
| application           | no      | No API change                                                                                                                                                                                                                                                                                                                                                                                               |
| contract              | no      | No contract change                                                                                                                                                                                                                                                                                                                                                                                          |
| http                  | no      | No API change                                                                                                                                                                                                                                                                                                                                                                                               |
| integration           | no      | No persistence change                                                                                                                                                                                                                                                                                                                                                                                       |
| mobile unit (pure TS) | yes     | `loginErrorMessage` (every code, `retryAfterSeconds` rounding, missing details, network error); `authFetch` (401 with Authorization calls the handler; 401 without it, 200, and no handler do not); `session-store` with `expo-secure-store` and `react-native` `Platform` mocked (persist/load/delete on native, no-ops on web, invalid JSON, expired `expiresAt`, missing fields)                         |
| mobile hook (jsdom)   | yes     | `SessionProvider`/`useSession` via `renderHook` with mocked `@/lib/api`, `session-store` and `auth-fetch`: restore none → `signedOut`; restore stored → `signedIn` and then the `me` update; sign-in remember true/false; `token: null` → error; sign-out calls `logOut` and clears even when `logOut` rejects; the unauthorized handler sets `notice: 'expired'`; `useSession` outside the provider throws |
| e2e                   | no      | (no e2e infrastructure yet) Screens and navigation guards are checked by the verifier in Expo web and, for persistence, in Expo Go                                                                                                                                                                                                                                                                          |

## Deviations

1. **Step 1, `apps/mobile/app.json` (not in the file list).** `expo install expo-secure-store`
   added the `"expo-secure-store"` config plugin to `plugins`. Cosmetic and generated by the
   documented install command; kept.
2. **Step 8, `scripts/quality/frontend-config.test.mjs` (not in the file list).** The mobile
   quality test linted a route at `src/app/index.tsx`, which this plan deletes, so `pnpm check`
   failed (`pnpm test:quality`). Fixed forward by changing the path to `src/app/(app)/index.tsx`
   (one line). Cosmetic, directly caused by the plan's deletion; the main session may revert it
   if it prefers to handle it elsewhere.
3. **Step 8, typed routes.** `.expo/types/router.d.ts` (git-ignored, generated) still listed
   `/empresas` and rejected `/yo`. It was regenerated by starting the Expo dev server briefly;
   no repo file changed. A fresh clone regenerates it on the first `expo start`.
4. **Step 6 (implementation detail).** The effect keeps its liveness flag in an object
   (`lifecycle.active` read through `isActive()`) because the lint rule
   `no-unnecessary-condition` rejects re-checking a narrowed `let`. Behavior is as specified.

5. **Review fix 1 (medium, stale requests).** `authFetch` now passes the bearer token it sent to
   the handler (`setUnauthorizedHandler` signature is `(rejectedToken: string) => void`). The
   provider ignores a 401 unless that token equals `getCurrentToken()`. The background `me()`
   refresh writes back only while `getCurrentToken() === stored.token`, and deletes the
   persisted entry if the session was closed during its `persistSession` await. `signIn` throws
   (instead of ending `signedIn` with no token) when the token changed during its awaits.
6. **Review fix 2 (low, SecureStore failure in `signIn`).** On a persist/delete failure it
   best-effort calls `api.identity.logOut()` (errors ignored), clears the in-memory session
   and rethrows. The login screen shows the generic non-`ApiError` message.
7. **Review fix 3 (low, web `Switch` double toggle).** In `login.tsx` the row `Pressable` is
   the only toggler (`accessibilityRole="switch"`, `accessibilityState` and `aria-checked`,
   44px min height kept); the `Switch` is wrapped in a `View pointerEvents="none"` hidden from
   accessibility and has no `onValueChange`. Not exercised on web (verifier).
8. **Review fix, tests (files already in the plan).** `session-provider.test.tsx` mocks
   `getCurrentToken` with a stateful token and adds tests for: a 401 from a stale token is
   ignored, a slow `me()` after sign-out does not resurrect the session, persist failure
   rolls back and revokes, and a 401 during `signIn`'s persist await does not end `signedIn`.
   `auth-fetch.test.ts` asserts the handler receives the token.
9. **Review fix (re-review 2026-11-10, low, web a11y of "Recordarme").** In `login.tsx`, on web
   the RN `Switch` (a real checkbox there) is no longer rendered; a visual track/thumb of Views
   (`aria-hidden`, tokens `primary`/`line`/`surface`) replaces it, so there is one switch named
   "Recordarme". The row adds a web `onKeyDown` that toggles on Space with `preventDefault`;
   Enter keeps going through RNW's press handling (`PressResponder.js:66-71`, `236-253`: Space
   is valid only for button roles, so no double toggle). Native keeps the hidden `Switch`; the
   deprecated `pointerEvents` prop became `style.pointerEvents`. Not exercised on web (verifier).

Not run: manual checks in Expo web / Expo Go (verifier's job). `expo export --platform android`
bundled successfully.

## Test coverage

Baseline `pnpm check`: green (mobile 25 tests). Layers per the plan: mobile unit (pure TS) and
mobile hook (jsdom); all others N/A (no API/contract/persistence change); e2e not set up.
53 new tests in 4 files under `apps/mobile/src/features/identity/` (mobile suite 78 tests). No GAPs found.

Second round (after review fixes, Deviations 5-8): the implementer's tests were reviewed against
`session-provider.tsx` and `auth-fetch.ts`; every assertion derives from real code. Changes by the
tester: the "401 during signIn persist" test now syncs with `waitFor(persist called)` instead of two
microtask ticks and also asserts the error message, `setSession(null)` and `user === null`; added
`auth-fetch` cases for `Headers` and tuple headers plus token extraction (`Bearer` prefix, any case);
added provider tests for the `me()` refresh deleting the persisted entry when the session closed
during its persist await (and not deleting it when the session is current), a slow `me()` not
overwriting a session with a different token, `me()` ApiError 401 changing nothing, rollback when
`logOut` also fails, and rollback when `deletePersistedSession` fails (remember off).
Not exercised: the "Recordarme" row on web (Deviations 7 and 9) stays NOT CONFIRMED for the verifier.

Third round (Deviation 9, visual track and web `onKeyDown` in `login.tsx`): no test added. The
screen cannot be rendered in vitest (no React Native renderer in the mobile jsdom setup), and
`handleRememberKeyDown` is a closure over component state and `Platform.OS`, so testing it would
mean extracting product code or inventing infrastructure. The behavior is NOT CONFIRMED; the
verifier must check on Expo web:

1. A single element with `role=switch` named "Recordarme" (no second switch nested inside).
2. `aria-checked` flips on mouse click, on Enter and on Space, exactly once per action (no
   double toggle).
3. Space does not scroll the page (`preventDefault`).
4. No focusable inner checkbox: Tab goes through the row only (the visual track is `aria-hidden`).
5. Native (Expo Go): the row still toggles and the hidden `Switch` is not announced.

| Behavior                                                                            | Source                                              | Layer              | Test                                                                          | State                    |
| ----------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------- | ------------------------ |
| Message per code (INVALID_CREDENTIALS, VALIDATION_ERROR, other, network)            | `login-error-message.ts:4-25`                       | mobile unit        | `login-error-message.test.ts`                                                 | CONFIRMED                |
| Blocked: ceil to minutes, min 1, missing/non-finite details falls back              | `login-error-message.ts:12-20`                      | mobile unit        | `login-error-message.test.ts`                                                 | CONFIRMED                |
| 401 with Authorization (any case) calls handler; without it / 200 / no handler no   | `auth-fetch.ts:21-27`                               | mobile unit        | `auth-fetch.test.ts`                                                          | CONFIRMED                |
| Response returned unchanged, args delegated to fetch                                | `auth-fetch.ts:22-26`                               | mobile unit        | `auth-fetch.test.ts`                                                          | CONFIRMED                |
| In-memory token get/set; set does not touch the store                               | `session-store.ts:18-25`                            | mobile unit        | `session-store.test.ts`                                                       | CONFIRMED                |
| persist/load/delete on native with key `rrhh.session`; no-ops on web                | `session-store.ts:31-73`                            | mobile unit        | `session-store.test.ts`                                                       | CONFIRMED                |
| Load: invalid JSON, missing token/user/expiresAt, expired -> null and key deleted   | `session-store.ts:36-67`                            | mobile unit        | `session-store.test.ts`                                                       | CONFIRMED                |
| Restore none -> signedOut; stored -> signedIn then `me` update + re-persist         | `session-provider.tsx:55-93`                        | mobile hook        | `session-provider.test.tsx › restauración`                                    | CONFIRMED                |
| `me` network failure keeps stored user; load throwing -> signedOut                  | `session-provider.tsx:66,89-91`                     | mobile hook        | `session-provider.test.tsx › restauración`                                    | CONFIRMED                |
| Handler registered on mount, unregistered on unmount                                | `session-provider.tsx:59,97`                        | mobile hook        | `session-provider.test.tsx › restauración`                                    | CONFIRMED                |
| signIn remember true/false; email trimmed, client mobile; token null throws         | `session-provider.tsx:101-123`                      | mobile hook        | `session-provider.test.tsx › signIn`                                          | CONFIRMED                |
| signIn error propagates, stays signedOut; clears expired notice                     | `session-provider.tsx:102,122`                      | mobile hook        | `session-provider.test.tsx › signIn`                                          | CONFIRMED                |
| signOut calls logOut, clears; clears even if logOut rejects                         | `session-provider.tsx:125-132`                      | mobile hook        | `session-provider.test.tsx › signOut`                                         | CONFIRMED                |
| Unauthorized handler -> signedOut with `notice: 'expired'`                          | `session-provider.tsx:45-53,59`                     | mobile hook        | `session-provider.test.tsx › sesión vencida`                                  | CONFIRMED                |
| 401 of a stale token ignored; handler receives the sent token                       | `session-provider.tsx:60-63`, `auth-fetch.ts:26-33` | mobile hook / unit | `sesión vencida`, `auth-fetch.test.ts`                                        | CONFIRMED                |
| Slow `me()` does not resurrect a closed session or overwrite a different token      | `session-provider.tsx:88`                           | mobile hook        | `me en segundo plano y carreras`, `sesión vencida`                            | CONFIRMED                |
| `me()` persist await + session closed -> persisted entry deleted                    | `session-provider.tsx:92-94`                        | mobile hook        | `me en segundo plano y carreras`                                              | CONFIRMED                |
| signIn persist/delete failure -> logOut best effort, memory cleared, error rethrown | `session-provider.tsx:127-137`                      | mobile hook        | `sesión vencida`, `me en segundo plano y carreras`... (signIn rollback tests) | CONFIRMED                |
| 401 during signIn persist await -> throws, not signedIn                             | `session-provider.tsx:139-141`                      | mobile hook        | `sesión vencida`                                                              | CONFIRMED                |
| "Recordarme" row on web: one switch; click/Enter/Space toggle once; no scroll       | `login.tsx:47-57,94-130` (Deviations 7, 9)          | e2e                | none                                                                          | NOT CONFIRMED (verifier) |
| `useSession` outside provider throws Spanish error                                  | `session-provider.tsx:142-148`                      | mobile hook        | `session-provider.test.tsx › useSession`                                      | CONFIRMED                |
| Screens, Stack.Protected guards, TextField, persistence on device                   | plan steps 7-10                                     | e2e                | none (no e2e infrastructure; verifier checks in Expo web/Expo Go)             | NOT TESTED               |

## Review findings

Review 2026-11-10 (reviewer subagent, uncommitted working tree vs `origin/main`).

**Checklist: 13/13 pass or N/A, with one note on scope.**

- Scope: `pnpm plans:scope … --base origin/main` exits 1, but only for items that are not
  findings. `apps/mobile/.gitignore` and `docs/referencia/…` are the known untracked
  out-of-plan files. `"src/app/(app)/index.tsx"` shows as "declared without changes" because
  the tool parses the parenthetical in step 8's file list as a path. The two files added by
  Deviations 1-2 are declared, and both diffs match their claims (one plugin line in `app.json`,
  one path in `frontend-config.test.mjs`).
- `pnpm check` exits 0: 19/19 turbo tasks, 67 mobile tests, and arch, plans, harness and quality
  all pass.
- No `infrastructure/`, schema, contract or DI change, so the integration, CQRS, Money and
  migration items are N/A.
- No token logging and no web storage: `grep console.|localStorage|sessionStorage|AsyncStorage`
  over `apps/mobile/src` finds nothing. `persistSession`, `loadPersistedSession` and
  `deletePersistedSession` are no-ops on web.
- `grep empresas|useCompanies` finds nothing. Docs are not stale.

### Medium

1. **The 401 handler and the background `me()` are not tied to the token they used, so an old
   request can change a newer session.**
   - Where: `session-provider.tsx:59-61` (the handler clears whatever session is current),
     `session-provider.tsx:81-88` (a successful `me()` writes back the token it started with),
     and `auth-fetch.ts:21-27` (it does not say which token was rejected).
   - Root cause: the only guard is `isActive()`, which tracks whether the effect is still
     mounted, not which session is current.
   - **Scenario A: a revoked token comes back after sign-out.** The app opens with a
     remembered session. The restore `me()` (token A) is slow on a bad network, and the user
     taps "Cerrar sesión".
     - `logOut` revokes A, and `clear(null)` empties memory and SecureStore.
     - Then the `me()` response (served before the revoke) arrives. `isActive()` is still
       true, so lines 85-88 run `setUser(fresh)`, `setCurrentSession({ token: A, … })` and
       `persistSession(...)`.
     - The revoked token is back in memory and in SecureStore while `status` is `signedOut`.
     - On the next login attempt, `/auth/login` is sent with `Authorization: Bearer A`
       (`client.ts:71` reads `getAccessToken` on every call). A wrong password then returns
       401 with an Authorization header, so the handler fires and the user sees a false "Tu
       sesión terminó".
     - On the next cold start, the stale entry is restored, signs the user in, and is kicked
       out by `me()`.
     - If `logOut` failed (offline at that moment), the token is still valid on the server
       and stays on the device after an explicit sign-out.
   - **Scenario B: a late 401 kills the new session.** The user signs out or expires and signs
     in again with token B while a request made with A is still in flight. When that request
     returns 401, the handler clears B's session with "Tu sesión terminó".
   - **Scenario B, worse case.** If the late 401 lands during `await persistSession` or
     `await deletePersistedSession` inside `signIn` (lines 114-122), `clear` sets the token to
     `null`, and then `signIn` still sets `status = 'signedIn'`.
     - The user is inside the app with no token, so every call goes out without Authorization.
     - Each 401 then has no header, so the handler never fires.
     - Recovery is only by "Cerrar sesión".
   - Likelihood: today the only bearer calls are `me()` and `logOut`, so the window is narrow.
     It grows with plan 003's data hooks.
   - Possible fix (the implementer decides): have `authFetch` pass the token it sent to the
     handler, and ignore the 401 unless that token is still `getCurrentToken()`. Have the
     `me()` refresh write back only if `getCurrentToken() === stored.token`.
   - This needs code changes plus a test for each race.

### Low

2. **If SecureStore fails during `signIn`, the token stays in memory while the user is
   signed out.**
   - Where: `session-provider.tsx:114-119`. `setCurrentSession(session)` runs before
     `await persistSession` / `deletePersistedSession`, and nothing rolls it back if they throw
     (for example, an Android keystore error).
   - What the user sees: `loginErrorMessage` shows the network message ("No se pudo
     conectar…"), which is misleading, and `status` stays `signedOut`.
   - What stays behind:
     - the new token remains in memory, so the next `/auth/login` carries `Bearer`;
     - a wrong password on that retry fires the handler, giving a false "Tu sesión terminó";
     - the server session that was just created is never revoked.
   - Fix direction: on failure, roll back the in-memory session. Alternatively, treat a
     persist failure as non-fatal and sign in memory-only.
   - The plan's order of operations (step 6) allows this. It is still a correctness gap.

3. **Probably a bug on web (verifier to confirm): clicking the `Switch` itself does not change
   "Recordarme".**
   - Where: `login.tsx:82-96`. The `Switch` sits inside a `Pressable` whose `onPress` also
     toggles the value.
   - Cause: in react-native-web, `Switch` is an `<input type="checkbox">` with `onChange` and
     does not stop propagation (`react-native-web/dist/exports/Switch/index.js:132-136`). The
     click bubbles up to the `Pressable`'s `onClick` (`usePressEvents/PressResponder.js:302-320`),
     which calls `onPress`.
   - Result: the value toggles twice, so nothing changes. Clicking the label text works.
   - Native is probably unaffected, because the native `Switch` claims the touch (not
     verified).
   - Possible fix: `pointerEvents="none"` or no `onValueChange` on the inner `Switch`. The
     implementer decides.

Uncertain or not a finding: on web, the session is in memory only, as the plan intends. A
`token: null` from login shows the network message, which matches step 5's table ("not an
`ApiError`"), although step 6 says "generic message".

**Result:** 1 medium and 2 low findings, all needing code changes. Status stays `review`.

### Re-review 2026-11-10 (after the review-fix round, Deviations 5-8)

Reviewer subagent, uncommitted working tree vs `origin/main`.

**Checklist: 13/13 pass or N/A.**

- Scope: `pnpm plans:scope … --base origin/main` exits 1 with only the two known out-of-plan
  files (`apps/mobile/.gitignore`, `docs/referencia/buk-portal-colaborador.md`). The step 8
  "declared without changes" artifact is gone (24 declared, 28 changed).
- `pnpm check` exits 0: format, 19/19 turbo tasks (mobile 78 tests), arch, plans, harness,
  bootstrap and quality all pass.
- No `infrastructure/`, schema, contract or DI change. No token logging and no web storage.
- Deviations spot-check: claim 5 matches the code (`auth-fetch.ts:29-31` passes the stripped
  token; `session-provider.tsx:60-63` compares it with `getCurrentToken()`; line 88 guards the
  `me()` write-back; line 94 re-deletes after the persist await).

**Earlier findings: all three fixed.**

1. Medium (stale 401 / stale `me()`): fixed.
   - Scenario A: a slow `me()` after sign-out now returns at line 88, because the current
     token is `null`.
   - Scenario B: a late 401 of token A while B is current is ignored (line 62).
   - Scenario B, worse case: `signIn` now throws at lines 139-141 instead of ending
     `signedIn` with no token.
   - Two simultaneous 401s for the current token: the second one sees `null` and is ignored.
   - Tests cover each race.
2. Low (SecureStore failure in `signIn`): fixed.
   - Lines 127-137 revoke on a best-effort basis while the token is still current, roll back
     memory only if it is still this session's token, and rethrow.
3. Low (web double toggle): fixed. The inner `Switch` has no `onValueChange`, and its wrapper
   has `pointerEvents="none"`, so only the row toggles.

**Regression hunt in `session-provider.tsx`: nothing blocking.** Residual windows, all
negligible today:

- `signIn` throw path (lines 139-141): the only way to reach it is a 401 for token B before
  `status` becomes `signedIn`, and no request uses B at that point. That path does not revoke
  B and does not re-delete the persisted entry. If it ever happens, a remembered B could
  survive. Not a finding today; worth keeping in mind if plan 003 adds requests that run
  while signed out.
- `me()` refresh persist versus a full sign-out → sign-in (remember off) inside one
  SecureStore write: this relies on SecureStore keeping operations in order. It needs a whole
  login round trip during one keystore write. Not a finding.

### Low

4. **Web only: the hidden `Switch` is still a focusable, unlabeled control, and Space does not
   toggle the row. This is a static reading of react-native-web 0.21.2, not checked in a
   browser.**
   - Where: `apps/mobile/src/app/login.tsx:82-99`.
   - On web, `accessibilityElementsHidden` and `importantForAccessibility` are not mapped to
     the DOM. `createDOMProps` handles neither; only `aria-hidden` / `accessibilityHidden`
     become `aria-hidden`.
   - The RNW `Switch` always renders a real `<input type="checkbox" role="switch">` with no
     `disabled` and no label, because no `accessibilityLabel` is passed
     (`react-native-web/dist/exports/Switch/index.js:127-138`).
   - `pointerEvents="none"` blocks clicks but not keyboard focus.
   - Failure scenario, keyboard or screen-reader user on Expo web:
     - Tab reaches the row (`div role="switch" aria-checked`, named "Recordarme"; correct),
       then a second, unnamed "switch" nested inside it.
     - Pressing Space on that inner control does nothing, because it is controlled and has
       no `onValueChange`.
     - On the row itself, only Enter toggles. RNW's `isValidKeyPress` accepts Space only for
       `button` roles (`usePressEvents/PressResponder.js:66-71`), while the ARIA switch
       pattern expects Space.
   - Native is fine:
     - The row has `accessibilityRole="switch"` and `accessibilityState.checked`.
     - The label comes from the `Recordarme` text child.
     - The inner `Switch` is hidden on iOS (`accessibilityElementsHidden`) and on Android
       (`importantForAccessibility="no-hide-descendants"`).
   - Possible direction (the implementer decides):
     - Add `aria-hidden` to the wrapper and keep the inner control out of the tab order. RNW
       only does that with `disabled`, which changes the colors, or with a purely visual
       track/thumb instead of `Switch`.
     - Optionally handle Space on the row on web.
   - Low severity: web is the dev/verification surface, and the target is native.

### Info (no code change)

- `## Test coverage` cites `auth-fetch.ts:196-203`. That file has 35 lines; the logic is at
  `auth-fetch.ts:26-33`. This is a wrong evidence reference, not a code problem.
- On web, RNW logs a dev warning that the `pointerEvents` prop is deprecated
  (`createDOMProps/index.js:804-805`). It is harmless.

**Result:** the three earlier findings are fixed. One new low finding (4) needs a code change
in `login.tsx`, so the status stays `review`. If the main session or the user accepts
finding 4 as a known web-only limitation, nothing else blocks `verify`.

### Re-review 2026-11-10 (finding 4 only, Deviation 9)

Scope: only the "Recordarme" row fix in `apps/mobile/src/app/login.tsx` and the regressions
around it. This is a static reading of react-native-web 0.21.2 and react-native 0.86.3. It was
not run in a browser or on a device, so the verifier still has to check the row (Test coverage,
third round, items 1-5).

- `pnpm check`: exit 0. Every step in the `&&` chain ran, through `test:quality`, and turbo
  reported 19/19 tasks.
- `pnpm plans:scope … --base origin/main`: exit 1. The only out-of-plan files are the two known
  ones, `apps/mobile/.gitignore` and `docs/referencia/buk-portal-colaborador.md`.

**Finding 4: fixed.**

- One switch on web:
  - `role="switch"` reaches the DOM: `propsToAriaRole` passes `switch` through, and
    `createDOMProps:607-610` writes `role`.
  - `propsToAccessibilityComponent` has no entry for `switch`, so the row renders as a `div`
    with `tabIndex=0` (Pressable defaults `tabIndex` to 0, `Pressable/index.js:118-123`).
  - `aria-checked` comes from the `aria-checked` prop (`createDOMProps:219-221`).
  - The web branch (`login.tsx:108-118`) no longer renders the RN `Switch`, so no
    `<input type="checkbox">` is left.
  - The visual track has `aria-hidden` (`createDOMProps:382-384`), and nothing inside the row
    can take focus.
  - The accessible name comes from the "Recordarme" text child, which the switch role allows
    as name-from-content.
- One switch on native:
  - The row keeps `accessibilityRole="switch"` and `checked`. RN merges `aria-checked` with
    `accessibilityState`, and both carry the same value (`Pressable.js:229`).
  - The inner `Switch` stays hidden with `accessibilityElementsHidden` and
    `importantForAccessibility="no-hide-descendants"`.
  - `style.pointerEvents: 'none'` is supported in RN 0.86 (`StyleSheetTypes.d.ts:513`), so the
    earlier deprecation note no longer applies.
  - `onKeyDown` is only added on web (`login.tsx:57`).
- Enter toggles once:
  - RNW's `Pressable` passes the user's `onKeyDown` through after its own press handler
    (`Pressable/index.js:110-117`).
  - The press responder starts on Enter keydown only while `NOT_RESPONDER`, so key repeat does
    not start it again (`PressResponder.js:240-247`).
  - `onPress` fires once, on keyup (`PressResponder.js:209-223`).
  - A `div` does not synthesize a `click` on Enter, and `handleRememberKeyDown` ignores Enter.
    That makes exactly one toggle.
- Space toggles once per press:
  - `isValidKeyPress` rejects Space for role `switch` (`PressResponder.js:66-71`), so only
    `handleRememberKeyDown` toggles.
  - It calls `preventDefault`, so the page does not scroll.
  - A `div` does not synthesize a `click` on Space either.
- No regressions in `login.tsx`:
  - `handleSubmit` (32-44), the `aria-live`/`accessibilityLiveRegion` error region (130-132),
    the submit `Button` (133-138) and `KeyboardAvoidingView` with `padding` only on iOS
    (60-63) match the reviewed behavior.
  - There is no `<form>`, so Enter on the row cannot submit.

#### Info (no code change)

- Holding Space down on web toggles the switch on every auto-repeat `keydown`, because
  `handleRememberKeyDown` does not check `event.repeat`. A native checkbox toggles once, on
  keyup. A normal press toggles exactly once. Only an unusual hold is affected, so this is not
  a finding. The verifier may note it.

**Result:** finding 4 is fixed and nothing new needs a code change. Status set to `verify`.

## Verification

### Run — 2026-11-10 (main session, inline)

**Suites:**

- `pnpm check`: green. The re-review confirmed exit 0, 19/19 tasks and 78 mobile tests.
- `pnpm --filter @rrhh/mobile exec expo export --platform android`: bundles. The output ends
  with `Android Bundled 13025ms … (1774 modules)`, and the 4.5 MB `.hbc` was exported.

**Running app:**

- Setup: Expo web on `:8081` with `EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1` passed on
  the command line (`.env` was not read), `pnpm dev:api` on `:3000`, and desktop Chrome in dark
  mode.
- The valid sign-in was typed by the user in the browser with the dev seed account
  `admin@example.com`. The password never passed through the session.
- A page-level `fetch` recorder logged only path and bearer presence, never the token value.

**Observed:**

- **Guards.**
  - Signed out, `/yo` lands on `/login`, with no `role=tab` on the page.
  - Signed in, `/` shows Inicio and the dock tabs read `Inicio=true` and `Yo=false`.
  - After logout, the app is back on `/login` with no tabs.
- **Login form (web DOM):**
  - The inputs are `email:Correo:email` and `password:Contraseña`.
  - "Entrar" with empty fields is `aria-disabled="true"` and `tabindex="-1"`. This also confirms
    plan 001's NOT VERIFIED disabled `Button` state.
- **"Recordarme" (finding 4):**
  - Exactly one `role=switch`, named `Recordarme`, `tabindex=0`, and no `input[type=checkbox]`
    on the page.
  - `aria-checked` after a click, then Enter, then Space is `true`, `false`, `true`: one toggle
    each.
  - `scrollY` stays 0 and focus stays on the switch.
- **Wrong password** (invented email `verificacion.plan002@example.com`, so the seed account is
  never throttled):
  - The `aria-live="polite"` region shows `Correo o contraseña incorrectos.`
  - The email is kept and the password field is cleared (length 0).
- **Throttle:** after repeated failures on the same invented email, the message is
  `Demasiados intentos. Intenta de nuevo en 15 min.`
- **Valid sign-in:** lands on Inicio ("Próximamente" tile, caption `Aparecerán aquí muy
pronto.`).
  - Yo shows `admin@example.com` and `Tu cuenta no está vinculada a un colaborador.`, which is
    correct for the seed admin, who has no `employeeId`.
- **Logout:**
  - The recorder logged `/api/v1/auth/logout bearer=yes`, and the app returned to `/login`.
  - The same token then gets `401` from `GET /auth/me`, called from the page with the captured
    token and showing only the status. The server session is revoked.
- **API down:** with `pnpm dev:api` stopped, submitting shows
  `No se pudo conectar. Revisa tu conexión e intenta de nuevo.`

**Observation (low, not blocking):**

- The password input renders with an empty `autocomplete` attribute on web, so browser
  password managers do not get the `current-password` hint.
- Native `autoComplete="password"` / `textContentType="password"` are unaffected.
- Left for a later polish plan; no repair loop opened.

**NOT VERIFIED:**

- **"Every later API request carries Bearer":** only partly confirmed. No screen calls the API
  while signed in except logout, which carried it. The restore `me()` only runs with a persisted
  session, which never happens on web.
- **Expired or revoked session while signed in, then "Tu sesión terminó":** not reachable on
  web, for the same reason (no API call to receive the 401). It is covered by the `auth-fetch`
  and `session-provider` tests.
- **"Recordarme" persistence across an app restart:** needs Expo Go on a device, since
  SecureStore does not exist on web. Web correctly never persists.
- **Native:** the switch row semantics, the hidden `Switch`, and keyboard avoidance.

**Cleanup:** the dev API, Expo web and the Chrome tab were stopped or closed. Seven failed
login attempts remain in the throttle table for the invented email only.

**Result:** every acceptance criterion that can be exercised on web passes. The remaining items
are device-only, or have no API call to exercise yet. **Ready for the user to decide on `done`.**
