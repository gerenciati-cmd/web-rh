---
status: done
module: mobile
min_implementer: mid
depends_on: []
---

# 001 — "Caribe" theme and base UI

## Context

`apps/mobile` is still the Expo template. Plan 001 replaces its look with the "Caribe" visual
direction the user chose:

- palette, IBM Plex fonts and minimal bento style (README decisions 2–3);
- reference design and measured contrasts in the artifact
  `https://claude.ai/artifact/G3jzFozEYzwJxe84cEETFL`.

The plan adds no data and no API calls. It changes the app shell, gives the app a set of base
components, and restyles the two existing screens so the verifier can see the theme working.

### What exists today

- **Tokens.** `apps/mobile/src/constants/theme.ts` is the only token file.
  - Palette: `COLORS.light`/`COLORS.dark`, five template grays, lines 7–22.
  - `ThemeColor`, line 24.
  - `FONTS`: system fonts via `Platform.select`, lines 26–49.
  - `SPACING`, lines 51–59.
  - `BOTTOM_TAB_INSET` and `MAX_CONTENT_WIDTH`, lines 61–62.
  - It imports `react-native` (line 5) and `@/global.css` (line 3), so it cannot be loaded by a
    plain vitest test.
- **Theme hook.** `useTheme()` returns `COLORS[scheme]` and maps `'unspecified'` to light
  (`apps/mobile/src/hooks/use-theme.ts:9-14`). The scheme comes from
  `apps/mobile/src/hooks/use-color-scheme.ts:1` (native) and
  `apps/mobile/src/hooks/use-color-scheme.web.ts:7-23` (web, hydration-safe).
- **Template components that read the old color keys:**
  - `themed-text.tsx` uses `theme[themeColor ?? 'text']` (line 17) and `FONTS.mono` (line 69).
  - `themed-view.tsx` uses `theme[type ?? 'background']` (line 21).
  - `hint-row.tsx:18-19` uses `backgroundSelected` and `textSecondary`.
  - `web-badge.tsx:15` and `ui/collapsible.tsx:13,23,28` also use them.

  These components must keep compiling.

- **Root layout** (`apps/mobile/src/app/_layout.tsx:1-20`):
  - calls `SplashScreen.preventAutoHideAsync()` at module scope (line 8);
  - wraps the app in `ThemeProvider` with `DarkTheme`/`DefaultTheme` from `expo-router`
    (lines 1, 15);
  - renders `AnimatedSplashOverlay` and `AppTabs` (lines 16–17).
- **Splash.** `AnimatedSplashOverlay` hides the native splash on its first layout
  (`apps/mobile/src/components/animated-icon.tsx:51-60`). It paints `#208AEF`
  (`animated-icon.tsx:149`), the same color as the native splash in
  `apps/mobile/app.json:31`.
- **Native tabs.** `AppTabs` uses `NativeTabs` from `expo-router/unstable-native-tabs` with PNG
  icons (`apps/mobile/src/components/app-tabs.tsx:1-33`). On iOS 26 the system draws that bar
  with Liquid Glass and ignores `backgroundColor`, so it cannot become the dark dock (README,
  "Considered and discarded").
- **Web tabs.** `app-tabs.web.tsx` replaces it on web. It is a headless `expo-router/ui` tab bar
  (`Tabs`, `TabList`, `TabTrigger`, `TabSlot`; lines 1–49), but it still points at template
  routes `home` and `/explore` (lines 24–29), and `/explore` does not exist.
- **Home screen.** `src/app/index.tsx` is the Expo welcome screen (lines 31–62). It uses
  `AnimatedIcon`, `HintRow` and `WebBadge`, plus `BOTTOM_TAB_INSET`/`MAX_CONTENT_WIDTH`
  (lines 5–10, 75–76).
- **Empresas screen.** `src/app/empresas.tsx` lists companies from `useCompanies()`
  (lines 7, 10). It has loading, error-with-retry and success/empty states (lines 17–39).
  Neither the hook nor its test changes.
- **Packages.** `apps/mobile/package.json` has `expo-font ~57.0.4`, `expo-symbols`,
  `expo-router`, `react-native-safe-area-context` and `react-native-reanimated`. It has no
  font package.
  - `@expo-google-fonts/ibm-plex-sans@0.4.1` and `@expo-google-fonts/ibm-plex-mono@0.4.1`
    exist on npm, published in September 2025, so they clear `minimumReleaseAge` in
    `pnpm-workspace.yaml:40-46`.
  - Their exported faces include `IBMPlexSans_400Regular`, `_500Medium`, `_600SemiBold`,
    `_700Bold` and `IBMPlexMono_400Regular`, `_500Medium`, `_600SemiBold`.
- **Tests.** Mobile tests run in vitest + jsdom over `src/**/*.test.{ts,tsx}`
  (`apps/mobile/vitest.config.ts:7-10`). They have no React Native renderer; the existing test
  covers a hook with `@testing-library/react`
  (`src/features/organization/hooks/use-companies.test.tsx:1-10`).

### Chosen approach

1. **Extend the existing token file instead of adding a second system.**
   - A new pure module `apps/mobile/src/constants/tokens.ts` holds the palette, radius, type
     families and dock metrics. It has no `react-native` import, so it is unit-testable.
   - `constants/theme.ts` stays the single entry point the app imports. It re-exports the
     tokens and keeps the legacy keys (`COLORS.*.text`, `background`, `backgroundElement`,
     `backgroundSelected`, `textSecondary`, plus `FONTS`, `SPACING`, `BOTTOM_TAB_INSET`,
     `MAX_CONTENT_WIDTH`) mapped onto the new palette.
   - Template components therefore keep compiling and take the new colors without edits.
   - Alternative rejected: a new `src/theme/` folder or a `packages/` token package. The first
     is a second theme beside `constants/theme.ts`; the second is cross-module work, see README
     "Considered and discarded".
2. **Load the fonts at runtime with `useFonts` from `expo-font`.** This works in Expo Go and
   uses the same family name on iOS and Android. The `expo-font` config plugin was rejected: it
   needs a development build and PostScript names on iOS. Each weight is its own family name,
   so components set `fontFamily` per weight and never set `fontWeight`.
3. **Build the dark dock with the headless `expo-router/ui` tabs**, on both native and web,
   imitating `apps/mobile/src/components/app-tabs.web.tsx:18-49` (`Tabs` + `TabSlot` +
   `TabList asChild` + `TabTrigger asChild`). Then delete the web override so web and native
   share one bar.
4. **Component shape** follows the Expo design-system conventions:
   - variants as props;
   - pressed feedback through the `Pressable` style function;
   - `accessibilityRole` and `accessibilityState` on interactive primitives;
   - the caller's `style` merged last;
   - `borderCurve: 'continuous'` on rounded surfaces;
   - text scaling left on.

Implementers: load the `expo:expo-overview` and `expo:expo-design-system` skills before writing
code. Read Expo SDK 57 docs for any API not quoted here (`apps/mobile/AGENTS.md`).

## Out of scope

- The web app (`apps/web`) and a shared token package: a later series (README decision 1).
- Login, sessions and any real data screen ("Hoy", attendance, vacations): plans 002 and 003.
- App icon, adaptive icon and the logo on the splash. No official APS asset is in the repo; the
  splash keeps the Expo logo and changes only its background color.
- Deleting unused template files: `hint-row.tsx`, `web-badge.tsx`, `ui/collapsible.tsx`,
  `animated-icon*.tsx`'s `AnimatedIcon`, `assets/images/tabIcons/*`. They keep compiling
  through the legacy keys.
- Animations beyond press feedback: the segmented control, hold-to-send and sheet motion of the
  artifact come with the screens that need them.
- Changing `useCompanies` or its test.

## Dependencies

None

## Steps

1. **Add the IBM Plex font packages**
   - Files: `apps/mobile/package.json` (modify), `pnpm-lock.yaml` (modify)
   - Do: from the repo root run
     `pnpm --filter @rrhh/mobile exec expo install @expo-google-fonts/ibm-plex-sans @expo-google-fonts/ibm-plex-mono`.
     Never edit `pnpm-lock.yaml` by hand; the install updates it.
   - Observable result: both packages appear in `dependencies` with exact versions, and
     `pnpm install --frozen-lockfile` succeeds.

2. **Create the pure token module**
   - Files: `apps/mobile/src/constants/tokens.ts` (create)
   - Do: export, with Spanish docblocks explaining the role of each token and no `react-native`
     import:
     - `PALETTE`, `as const`, with identical keys in `light` and `dark`. Values (light → dark):

       | Key          | Light                    | Dark                     |
       | ------------ | ------------------------ | ------------------------ |
       | `paper`      | `#F6F5F1`                | `#0A1314`                |
       | `surface`    | `#FFFFFF`                | `#121D1F`                |
       | `sunk`       | `#EEECE6`                | `#172629`                |
       | `line`       | `#E4E1D9`                | `#23302F`                |
       | `ink`        | `#0F1F22`                | `#EEF1EC`                |
       | `ink2`       | `#44524F`                | `#B5BFBB`                |
       | `ink3`       | `#5F6965`                | `#85918D`                |
       | `shell`      | `#0A2226`                | `#050C0D`                |
       | `onShell`    | `#EEF1EC`                | `#EEF1EC`                |
       | `onShell2`   | `#9FB3B1`                | `#9FB3B1`                |
       | `primary`    | `#004750`                | `#36B0C9`                |
       | `onPrimary`  | `#FFFFFF`                | `#04252A`                |
       | `accent`     | `#36B0C9`                | `#36B0C9`                |
       | `accentText` | `#0B7088`                | `#5FCBE0`                |
       | `sand`       | `#D9B47A`                | `#E2C08A`                |
       | `sandText`   | `#7A5418`                | `#E2C08A`                |
       | `sandSoft`   | `#F3EBDD`                | `#2A2316`                |
       | `success`    | `#1F7A45`                | `#5FC98A`                |
       | `successBg`  | `#E6F3EA`                | `#12352A`                |
       | `warning`    | `#9A5B0B`                | `#E5A94A`                |
       | `warningBg`  | `#FBF0DC`                | `#3A2C12`                |
       | `danger`     | `#B4363F`                | `#F0817F`                |
       | `dangerBg`   | `#F9E5E6`                | `#3E1E22`                |
       | `dockActive` | `rgba(255,255,255,0.08)` | `rgba(255,255,255,0.08)` |

     - `type PaletteKey = keyof typeof PALETTE.light` and `type Scheme = 'light' | 'dark'`.
     - `TEXT_PAIRS`: a readonly array of `[foreground, background]` `PaletteKey` tuples that the
       UI is allowed to use for text: `ink/paper`, `ink/surface`, `ink/sunk`, `ink2/paper`,
       `ink2/surface`, `ink2/sunk`, `ink3/paper`, `ink3/surface`, `ink3/sunk`, `onShell/shell`,
       `onShell2/shell`, `onPrimary/primary`, `accentText/paper`, `accentText/surface`,
       `accentText/sunk`, `sandText/surface`, `sandText/sandSoft`, `success/successBg`,
       `warning/warningBg`, `danger/dangerBg`.
     - `RADIUS = { xs: 6, sm: 8, md: 12, lg: 18, sheet: 22, pill: 999 } as const`.
     - `FONT_FAMILY`:
       - `sans.regular`, `sans.medium`, `sans.semibold`, `sans.bold` are
         `'IBMPlexSans_400Regular'`, `'IBMPlexSans_500Medium'`, `'IBMPlexSans_600SemiBold'`,
         `'IBMPlexSans_700Bold'`;
       - `mono.regular`, `mono.medium`, `mono.semibold` are `'IBMPlexMono_400Regular'`,
         `'IBMPlexMono_500Medium'`, `'IBMPlexMono_600SemiBold'`.
     - `DOCK = { height: 64, sideInset: 14, bottomGap: 14 } as const` and
       `DOCK_CLEARANCE = DOCK.height + DOCK.bottomGap + 16`. That is the bottom padding a
       scrollable screen needs so its last item is not hidden behind the dock.
   - Observable result: `pnpm --filter @rrhh/mobile typecheck` passes. The file imports nothing.

3. **Create the WCAG contrast helper**
   - Files: `apps/mobile/src/constants/contrast.ts` (create), `apps/mobile/src/constants/tokens.test.ts` (create, by the tester)
   - Do: export `relativeLuminance(hex: string): number` and
     `contrastRatio(foreground: string, background: string): number` using the WCAG 2.x
     formula:
     - channel `c/255`; if `≤ 0.03928` then `c/12.92`, otherwise `((c+0.055)/1.055)^2.4`;
     - `L = 0.2126 R + 0.7152 G + 0.0722 B`;
     - ratio `(Lmax+0.05)/(Lmin+0.05)`.

     Accept only 6-digit `#RRGGBB`; throw an `Error` with a Spanish message for anything else
     (`rgba()` tokens are never text colors). No `react-native` import.

   - Observable result: `contrastRatio('#000000', '#FFFFFF')` returns 21 and
     `contrastRatio('#36B0C9', '#FFFFFF')` returns about 2.56. The tester asserts both.

4. **Rewire the token entry point**
   - Files: `apps/mobile/src/constants/theme.ts` (modify)
   - Do:
     - Keep the `import '@/global.css'` line and the docblock.
     - Re-export `PALETTE`, `PaletteKey`, `Scheme`, `RADIUS`, `FONT_FAMILY`, `DOCK` and
       `DOCK_CLEARANCE` from `./tokens`.
     - Rebuild `COLORS` from `PALETTE` with the legacy keys, for both schemes: `text: ink`,
       `background: paper`, `backgroundElement: sunk`, `backgroundSelected: line`,
       `textSecondary: ink2`.
     - Keep `ThemeColor` as `keyof typeof COLORS.light`.
     - Replace `FONTS` with a plain object, the same on every platform:
       `{ sans: FONT_FAMILY.sans.regular, serif: FONT_FAMILY.sans.regular, rounded: FONT_FAMILY.sans.regular, mono: FONT_FAMILY.mono.regular }`.
       Drop the `Platform.select` for fonts.
     - Keep `SPACING`, `BOTTOM_TAB_INSET` and `MAX_CONTENT_WIDTH` unchanged.
   - Observable result: `themed-text.tsx`, `themed-view.tsx`, `hint-row.tsx`, `web-badge.tsx`
     and `ui/collapsible.tsx` compile without edits, and `pnpm --filter @rrhh/mobile typecheck`
     passes.

5. **Add the palette hook**
   - Files: `apps/mobile/src/hooks/use-palette.ts` (create), `apps/mobile/src/hooks/use-palette.test.tsx` (create, by the tester after review fix M1)
   - Do: export `usePalette()` returning `PALETTE[scheme]`. Resolve the scheme exactly like
     `apps/mobile/src/hooks/use-theme.ts:9-14`: `useColorScheme` from `@/hooks/use-color-scheme`,
     with `'unspecified'` (and `null`/`undefined`) treated as `'light'`.
   - Observable result: typecheck passes. Components in later steps read colors only through
     this hook.

6. **Load fonts, theme the navigation container, recolor the splash**
   - Files: `apps/mobile/src/app/_layout.tsx` (modify), `apps/mobile/src/components/animated-icon.tsx` (modify), `apps/mobile/app.json` (modify)
   - Do:
     - **`_layout.tsx`:**
       - Call `useFonts` from `expo-font` with the seven faces from step 2, importing each font
         object from `@expo-google-fonts/ibm-plex-sans` and `@expo-google-fonts/ibm-plex-mono`.
       - While `!loaded && !error`, return `null`. The native splash stays up because of the
         existing `preventAutoHideAsync()` (line 8). On `error`, render the app anyway: fonts
         fall back to the system face and must not block the app.
       - Pass `ThemeProvider` a navigation theme built from `PALETTE`:
         `{ ...DefaultTheme, colors: { ...DefaultTheme.colors, background: paper, card: surface, text: ink, border: line, primary: primary } }`,
         and the same from `DarkTheme` with the dark palette.
       - Keep `AnimatedSplashOverlay` and `AppTabs` in place.
     - **`animated-icon.tsx`:** change only `splashOverlay.backgroundColor` (line 149) to
       `PALETTE.light.shell`, imported from `@/constants/theme`.
     - **`app.json`:** change only the `expo-splash-screen` `backgroundColor` (line 31) to
       `#0A2226`.
   - Observable result: the app starts in Expo Go and on web with a dark petrol splash, and its
     text renders in IBM Plex Sans. On web, the computed `font-family` of any text includes
     `IBMPlexSans_400Regular` or another IBM Plex face.

7. **Create the base components**
   - Files: `apps/mobile/src/components/ui/text.tsx` (create), `apps/mobile/src/components/ui/tile.tsx` (create), `apps/mobile/src/components/ui/chip.tsx` (create), `apps/mobile/src/components/ui/button.tsx` (create), `apps/mobile/src/components/ui/shell-header.tsx` (create)
   - Do: all colors come from `usePalette()` and all families from `FONT_FAMILY`. Never set
     `fontWeight`. Keep text scaling on. Merge the caller's `style` last. Named exports only.
     - **`AppText`** (`text.tsx`): props `TextProps & { variant?: …; tone?: PaletteKey }`. Every
       variant except `label` has default tone `ink`; `label` has `ink3`.

       | Variant          | Size / line height | Family                                                           |
       | ---------------- | ------------------ | ---------------------------------------------------------------- |
       | `display`        | 28/32              | sans semibold, letterSpacing −0.5                                |
       | `title`          | 20/26              | sans semibold                                                    |
       | `body` (default) | 15/22              | sans regular                                                     |
       | `bodyStrong`     | 15/22              | sans medium                                                      |
       | `caption`        | 12.5/17            | sans regular                                                     |
       | `label`          | 11/14              | mono medium, `textTransform: 'uppercase'`, letterSpacing 0.6     |
       | `figure`         | 24/28              | mono medium, `fontVariant: ['tabular-nums']`, letterSpacing −0.6 |

     - **`Tile`** (`tile.tsx`):
       - props `ViewProps & { tone?: 'surface' | 'sunk'; onPress?: () => void; accessibilityLabel?: string }`;
       - style: background `surface` (or `sunk`), 1 px `line` border (none for `sunk`),
         `RADIUS.md`, `borderCurve: 'continuous'`, padding 12, `gap` 6;
       - with `onPress`, render a `Pressable` with `accessibilityRole="button"` and
         `transform: [{ scale: 0.97 }]` while pressed; otherwise render a `View`.
     - **`Chip`** (`chip.tsx`):
       - props `{ label: string; tone?: 'success' | 'warning' | 'danger' | 'sand' | 'neutral' }`;
       - pill shape `RADIUS.pill`, padding 2×8, text 11/14 sans semibold;
       - backgrounds and text by tone: `successBg`/`success`, `warningBg`/`warning`,
         `dangerBg`/`danger`, `sandSoft`/`sandText`, `sunk`/`ink2`.
     - **`Button`** (`button.tsx`):
       - props `{ title: string; onPress?: () => void; variant?: 'primary' | 'secondary'; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle> }`;
       - `Pressable` with `minHeight: 48`, `RADIUS.md`, `borderCurve: 'continuous'`, horizontal
         padding 16, centered;
       - colors: `primary` uses background `primary` and text `onPrimary`; `secondary` uses
         background `sunk` and text `ink`; text 15/20 sans semibold;
       - pressed: `scale 0.97`; disabled or loading: opacity 0.45 and no `onPress`;
       - loading shows `ActivityIndicator` in the text color, keeps `accessibilityLabel={title}`,
         and sets `accessibilityState={{ disabled, busy: loading }}`.
     - **`ShellHeader`** (`shell-header.tsx`):
       - props `{ eyebrow?: string; title: string; right?: ReactNode }`;
       - a full-width `View` with background `shell`;
       - `paddingTop = useSafeAreaInsets().top + 12`, `paddingHorizontal: 16`,
         `paddingBottom: 16`;
       - eyebrow: `AppText variant="caption" tone="onShell2"`; title:
         `AppText variant="display" tone="onShell"`; `right` aligned to the end of the title row.
   - Observable result: `pnpm --filter @rrhh/mobile typecheck` and `lint` pass. Steps 9–10 render
     every component.

8. **Replace the tab bar with the floating dark dock**
   - Files: `apps/mobile/src/components/app-tabs.tsx` (modify), `apps/mobile/src/components/app-tabs.web.tsx` (delete)
   - Do:
     - **Rewrite `app-tabs.tsx`** with `Tabs`, `TabSlot`, `TabList`, `TabTrigger` and
       `TabTriggerSlotProps` from `expo-router/ui`, imitating `app-tabs.web.tsx:18-49`:
       - `<Tabs>` holds `<TabSlot style={{ height: '100%' }} />`, then
         `<TabList asChild><Dock>…</Dock></TabList>`;
       - two triggers: `name="index" href="/"` labeled `Inicio`, and
         `name="empresas" href="/empresas"` labeled `Empresas`.
     - **`Dock`:** an absolutely positioned `View`:
       - left and right `DOCK.sideInset`, bottom `useSafeAreaInsets().bottom + DOCK.bottomGap`;
       - background `shell`, radius `RADIUS.lg`, `borderCurve: 'continuous'`, padding 6;
       - `flexDirection: 'row'`, each trigger `flex: 1`.
     - **`DockButton`:** takes `TabTriggerSlotProps` plus an icon name.
       - `Pressable` with `accessibilityRole="tab"`, `accessibilityState={{ selected: isFocused }}`,
         `minHeight: 48`, radius `RADIUS.md`, centered icon over label.
       - Background `dockActive` when focused.
       - Icon: `SymbolView` from `expo-symbols`, size 20, tint `accent` when focused and
         `onShell2` otherwise, as used in `app-tabs.web.tsx:67-71`. Names: Inicio
         `{ ios: 'house', android: 'home', web: 'home' }`; Empresas
         `{ ios: 'building.2', android: 'apartment', web: 'apartment' }`. If the type rejects a
         name, use the closest valid Material Symbols name and record it in Deviations.
       - Label: 10.5/13 `sans.medium`, `onShell` when focused and `onShell2` otherwise.
       - Pressed: `scale 0.97`. No animation when switching tabs.
     - **Delete `app-tabs.web.tsx`** so web and native use the same bar.
   - Observable result:
     - On native and web, a dark rounded dock floats above the bottom safe area with "Inicio"
       and "Empresas".
     - The focused tab shows the cyan icon and the lighter background, and switching tabs
       changes the screen.
     - `/explore` is no longer referenced anywhere (`grep -rn explore apps/mobile/src` returns
       nothing).

9. **Rebuild the Inicio screen**
   - Files: `apps/mobile/src/app/index.tsx` (modify)
   - Do: replace the template content and drop the `AnimatedIcon`, `HintRow`, `WebBadge` and
     `expo-device` imports.
     - Render `ShellHeader` with eyebrow `RRHH APS` and title `Inicio`, then a `ScrollView`
       with background `paper`, padding 10, `gap` 8 and `paddingBottom: DOCK_CLEARANCE`.
     - Inside, one `Tile`:
       - `AppText variant="label"` `Próximamente`;
       - `AppText variant="bodyStrong"` `Tu jornada, tus vacaciones y tus solicitudes`;
       - `AppText variant="caption" tone="ink2"`
         `Aparecerán aquí cuando inicies sesión con tu cuenta.`
     - Below it, `<Link href="/empresas" asChild><Button variant="secondary" title="Ver empresas" /></Link>`.
       `Link` comes from `expo-router`; `Button` must forward the props `Link` passes.
   - Observable result: Inicio shows the dark header, one tile and the secondary button.
     Tapping the button opens Empresas. No English template text remains.

10. **Restyle the Empresas screen**
    - Files: `apps/mobile/src/app/empresas.tsx` (modify)
    - Do: keep `useCompanies()` and its three states.
      - Render `ShellHeader` with eyebrow `Holding` and title `Empresas`, then a body with
        background `paper`.
      - **loading:** `AppText variant="caption" tone="ink2"` `Cargando empresas…`, padded 16.
      - **error:** a `Tile` with `AppText tone="danger"`
        `No se pudo cargar el listado: {state.message}.` and
        `Button variant="primary" title="Reintentar"` calling `void reload()`.
      - **success:** `FlatList` with
        `contentContainerStyle={{ padding: 10, gap: 8, paddingBottom: DOCK_CLEARANCE }}`. Each
        item is a `Tile`:
        - `AppText variant="bodyStrong"` with `legalName`;
        - a row with `AppText variant="label"` showing `{taxId} · {country}` and, at the end,
          `Chip` `Activa` (`success`) or `Inactiva` (`neutral`).
      - **empty:** `AppText variant="caption" tone="ink2"`
        `Aún no hay empresas registradas.`
    - Observable result: with the API up and companies seeded, each company shows as a tile with
      mono tax ID and a status chip. The last tile is fully visible above the dock. With the API
      down, the error tile shows the message, and "Reintentar" reloads.

## Acceptance criteria

- [ ] `pnpm check` passes, including the mobile typecheck, lint and tests.
- [ ] In Expo Go (or a simulator) and on Expo web, the splash is dark petrol `#0A2226`, and all
      text renders in IBM Plex. Figures and tax IDs render in IBM Plex Mono.
- [ ] A dark floating dock with "Inicio" and "Empresas" sits above the bottom safe area on both
      native and web. The focused tab is visibly marked with the cyan icon and the lighter
      background, and switching tabs has no animation.
- [ ] Inicio shows the dark header and the "Próximamente" tile. Its button opens Empresas.
- [ ] Empresas shows tiles with a mono tax ID and an `Activa`/`Inactiva` chip. The last tile is
      not hidden behind the dock. Stopping the API shows the error tile, and "Reintentar"
      recovers once the API is back.
- [ ] Switching the OS appearance to dark changes the paper, surfaces and text to the dark
      palette with no unreadable text. The header and dock stay dark.
- [ ] Buttons and tappable tiles shrink slightly while pressed.
- [ ] No component outside `apps/mobile/src/constants/` contains a hex color literal, except
      the existing template files listed in Out of scope.

## Test layers required

| Layer                 | Applies | Focus                                                                                                                                                                                                                                                                                   |
| --------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain                | no      | No API change                                                                                                                                                                                                                                                                           |
| application           | no      | No API change                                                                                                                                                                                                                                                                           |
| contract              | no      | No contract change                                                                                                                                                                                                                                                                      |
| http                  | no      | No API change                                                                                                                                                                                                                                                                           |
| integration           | no      | No persistence                                                                                                                                                                                                                                                                          |
| mobile unit (pure TS) | yes     | `contrast.ts` against known values (21, 1, about 2.56); every `TEXT_PAIRS` entry is at least 4.5 in light and dark; `PALETTE.light` and `PALETTE.dark` have the same keys; `FONT_FAMILY` names match the keys exported by the two font packages. No React Native import in these tests. |
| e2e                   | no      | (no e2e infrastructure yet) Components and screens are checked by the verifier in the running app; there is no React Native renderer in the mobile vitest setup.                                                                                                                        |

## Deviations

- Cosmetic, step 8: the dock label sets `maxFontSizeMultiplier={1.3}` so the fixed-height dock does
  not grow without bound under large system fonts. The plan said "text scaling left on"; scaling
  stays on, only capped on that one label.
- Cosmetic, steps 7/8: ESLint (`consistent-type-definitions`) requires `interface` for `ButtonProps`,
  `ChipProps` and `ShellHeaderProps`; used `interface` instead of `type` for those.
- Symbol names for the dock icons were accepted by the type check as written; no change.
- `pnpm plans:scope` against the stale local `main` listed many files from earlier merged work
  (attendance, employees, contracts). Against `origin/main` the real cause was the plan's format:
  the `Files:` lists of steps 6-8 wrapped onto several lines and `tokens.test.ts` was undeclared
  (review M2, fixed by the main session). `scope.mjs` does include untracked files. No file outside
  the plan's list was edited by this implementation.
- Review fix M1 (changes step 2/9/10): `DOCK_CLEARANCE` did not include the bottom safe-area inset,
  so the dock hid the last item on devices with a home indicator. Added `useDockClearance()` to
  `hooks/use-palette.ts` (`DOCK_CLEARANCE + useSafeAreaInsets().bottom`); `app/index.tsx` and
  `app/empresas.tsx` use it instead of the bare constant. `DOCK_CLEARANCE` itself is unchanged.
- Review fix L4: the dock in `app-tabs.tsx` now sets `height: DOCK.height`, so the token and the
  real dock match (it was 60 from padding + `minHeight`).
- Review fix L3: added `['danger', 'surface']` to `TEXT_PAIRS` (used by the error tile in
  `empresas.tsx`); the existing test iterates it.
- Review fix L2: corrected the inaccurate plans:scope bullet above.
- Not done in this phase (belongs to later phases): runtime checks in Expo Go/web (splash,
  fonts, dock, dark mode), which the verifier covers; unit tests for tokens and contrast, which
  the tester writes.
- Repair (verification): `accessibilityState` is not rendered as `aria-*` by react-native-web 0.21
  (second verification run, low a11y failure). Replaced it with `aria-selected` in
  `components/app-tabs.tsx` and `aria-disabled` + `aria-busy` in `components/ui/button.tsx` (prop
  names confirmed in react-native's `ViewAccessibility.d.ts`); `accessibilityRole` kept. `chip.tsx`
  and `tile.tsx` have no `accessibilityState`. The earlier verification is superseded for these two
  files only; the a11y check needs a re-run.
- Review fix (L1, verification repair): react-native-web's `Pressable` renders
  `aria-disabled={props.disabled}` after spreading `rest`, so the `aria-disabled` set in
  `components/ui/button.tsx` was overwritten and a disabled/loading `Button` was not announced as
  disabled on web. `Button` now passes `disabled={inactive}` to the `Pressable`. `aria-disabled` was
  removed as redundant: on web the `Pressable` derives it from `disabled`; on native, react-native's
  `Pressable` builds `accessibilityState.disabled` from `disabled` (`Pressable.js` lines ~230-236).
  `aria-busy` and the `onPress` guard are kept. This supersedes the `aria-disabled` part of the
  earlier "Repair (verification)" entry; the a11y check needs a re-run.

## Test coverage

Baseline `pnpm check`: green (before any test). One new file:
`apps/mobile/src/constants/tokens.test.ts` (17 tests, mobile unit, pure TS, no React Native import).

| Behavior                                               | Source                | Layer       | Test                                                        | State                                        |
| ------------------------------------------------------ | --------------------- | ----------- | ----------------------------------------------------------- | -------------------------------------------- |
| Black on white = 21; same color = 1; accent/white 2.56 | `contrast.ts:17-23`   | mobile unit | `contrastRatio › da 21…`, `da 1…`, `da cerca de 2.56…`      | CONFIRMED                                    |
| Ratio is symmetric; lowercase hex accepted             | `contrast.ts:11-23`   | mobile unit | `es simétrico…`, `acepta minúsculas`                        | CONFIRMED                                    |
| Rejects non-`#RRGGBB` (3-digit, no `#`, rgba, invalid) | `contrast.ts:3,12-14` | mobile unit | `rechaza el formato inválido…` (5 cases)                    | CONFIRMED                                    |
| Light and dark palettes have identical keys            | `tokens.ts:10-84`     | mobile unit | `PALETTE › tiene las mismas claves…`                        | CONFIRMED                                    |
| Every `TEXT_PAIRS` entry >= 4.5 in light and dark      | `tokens.ts:93-115`    | mobile unit | `PALETTE › cumple AA (4.5)…` (light, dark)                  | CONFIRMED                                    |
| `TEXT_PAIRS` use existing keys, no duplicates          | `tokens.ts:93-115`    | mobile unit | `solo declara pares con claves existentes…`                 | CONFIRMED                                    |
| `DOCK_CLEARANCE` = height + bottomGap + 16             | `tokens.ts:140-146`   | mobile unit | `DOCK › DOCK_CLEARANCE…`                                    | CONFIRMED                                    |
| `FONT_FAMILY` names match the font packages' faces     | `tokens.ts:122-135`   | mobile unit | `FONT_FAMILY › cada nombre existe…` (checks `.ttf` shipped) | CONFIRMED                                    |
| Splash, fonts rendered, dock, dark mode, components    | plan steps 6-10       | e2e/device  | none: no React Native renderer in mobile vitest             | NOT CONFIRMED (verifier, in the running app) |

No GAPs found. Font check reads the package's shipped `.ttf` files, not the app's source text.

### Re-test after review fix (M1, L3, L4)

Scope compared against `origin/main` (local `main` is stale); `docs/referencia/` is pre-existing user
work and is not touched. Mobile suite now 30 tests (was 22): +7 in the new
`apps/mobile/src/hooks/use-palette.test.tsx`, +1 in `tokens.test.ts`. Mobile unit, no React Native
renderer: `theme.ts` is replaced by the pure `tokens.ts` via `vi.mock`, and `use-color-scheme` and
`react-native-safe-area-context` are mocked.

| Behavior                                                       | Source                      | Layer       | Test                                                       | State                                                                        |
| -------------------------------------------------------------- | --------------------------- | ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `useDockClearance()` = `DOCK_CLEARANCE` with inset 0           | `use-palette.ts:17-19`      | mobile unit | `useDockClearance › sin inset inferior…`                   | CONFIRMED (mocked inset)                                                     |
| `useDockClearance()` adds `insets.bottom` (34 case)            | `use-palette.ts:17-19`      | mobile unit | `useDockClearance › suma el inset inferior…`               | CONFIRMED (mocked inset)                                                     |
| `usePalette()` scheme resolution (dark/light/unspecified/null) | `use-palette.ts:7-11`       | mobile unit | `usePalette › esquema … resuelve la paleta …` (5 cases)    | CONFIRMED                                                                    |
| `['danger','surface']` is in `TEXT_PAIRS` and passes AA 4.5    | `tokens.ts` `TEXT_PAIRS`    | mobile unit | `incluye danger/surface…` + existing AA test (light, dark) | CONFIRMED                                                                    |
| Dock `height: DOCK.height` equals the token                    | `app-tabs.tsx:98`           | e2e/device  | none: style of a native component, no renderer             | NOT CONFIRMED (verifier: measure the dock = 64)                              |
| Last Empresas tile clear of the dock with a real bottom inset  | `empresas.tsx`, `index.tsx` | e2e/device  | none: needs a real safe-area inset and layout              | NOT CONFIRMED (verifier: iOS/Android device, scroll to end; web has inset 0) |

No GAPs found in this round.

### Re-test after verification repair (`aria-*` instead of `accessibilityState`)

Scope compared against `origin/main`; `docs/referencia/` is pre-existing user work and is not
touched. No test file was added or changed in this round. Baseline = closing `pnpm check`: green
(turbo 19/19, mobile 30 tests, unchanged).

A render test is not feasible without inventing a renderer. The mobile vitest config
(`apps/mobile/vitest.config.ts`) is plain jsdom with no `react-native` alias, setup file or
renderer. `react-native-web` is a dependency, but wiring it into vitest (alias, `vi.mock` of
native modules, `expo-router/ui` internals) would be new test infrastructure outside this plan's
file list, and its output would not prove what the verifier saw in Expo web. So these rows stay
NOT CONFIRMED for the verifier.

| Behavior                                                                        | Source                       | Layer      | Test                           | State                                                                                                        |
| ------------------------------------------------------------------------------- | ---------------------------- | ---------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Dock tab renders `aria-selected="true"` when focused, `"false"` otherwise       | `app-tabs.tsx:73-74`         | e2e/device | none: no React Native renderer | NOT CONFIRMED (verifier: Expo web, inspect both tabs; re-check the failed 2nd-run item)                      |
| `Button` renders `aria-disabled` when disabled or loading                       | `button.tsx:46`              | e2e/device | none: no React Native renderer | NOT CONFIRMED (verifier: Expo web, needs a disabled or loading `Button` on screen)                           |
| `Button` renders `aria-busy` while loading                                      | `button.tsx:47`              | e2e/device | none: no React Native renderer | NOT CONFIRMED (verifier: same; "Reintentar" is the only `Button` that can load today)                        |
| `accessibilityRole` (`tab`, `button`) still maps to `role` after the repair     | `app-tabs.tsx`, `button.tsx` | e2e/device | none: no React Native renderer | NOT CONFIRMED (verifier: the 2nd run already saw `role=tab` before the repair)                               |
| Native (iOS/Android) mapping of `aria-selected` / `aria-disabled` / `aria-busy` | `app-tabs.tsx`, `button.tsx` | e2e/device | none                           | NOT CONFIRMED (device only; the prop names were checked against `ViewAccessibility.d.ts` by the implementer) |

No GAPs found in this round.

### Re-test after review fix L1 (`disabled={inactive}` on `Button`, `aria-disabled` removed)

Scope compared against `origin/main`. `docs/referencia/` and `apps/mobile/.gitignore` (generated by
`expo start`) are known out-of-plan files and were left alone. No test file was added or changed.
Baseline = closing `pnpm check`: green (turbo 19/19, mobile 30 tests, unchanged).

A render test is still not feasible: the mobile vitest config is plain jsdom with no React Native
renderer, and the result depends on react-native-web's `Pressable` internals, so a test would need
new infrastructure outside this plan's file list. The rows below supersede the `Button` rows of the
previous round and stay NOT CONFIRMED for the verifier.

| Behavior                                                                      | Source               | Layer      | Test                           | State                                                                                                 |
| ----------------------------------------------------------------------------- | -------------------- | ---------- | ------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Disabled or loading `Button` renders `aria-disabled="true"` and `tabindex=-1` | `button.tsx:43`      | e2e/device | none: no React Native renderer | NOT CONFIRMED (verifier: Expo web; needs a disabled or loading `Button` on screen, none exists today) |
| `Button` renders `aria-busy` while loading                                    | `button.tsx:47`      | e2e/device | none: no React Native renderer | NOT CONFIRMED (verifier: same)                                                                        |
| `onPress` is not called when disabled or loading                              | `button.tsx:43-44`   | e2e/device | none: no React Native renderer | NOT CONFIRMED (verifier: press a disabled `Button`)                                                   |
| Native: `Pressable` derives `accessibilityState.disabled` from `disabled`     | `button.tsx:43`      | e2e/device | none                           | NOT CONFIRMED (device only; the implementer read `Pressable.js` ~230-236)                             |
| Dock tab `aria-selected` (unchanged by this repair)                           | `app-tabs.tsx:73-74` | e2e/device | none: no React Native renderer | NOT CONFIRMED (verifier: Expo web; see the previous round)                                            |

No GAPs found in this round.

## Review findings

Review 2026-11-10. Diff compared against `origin/main` (edad282), because the local `main` is
stale. It covers the working-tree changes and the untracked files under `apps/mobile` and
`plans/mobile-app-colaborador`. `docs/referencia/` is earlier work by the user and is not part
of this plan.

### Checklist: 11/13 (N/A items count as passed)

- [ ] **FAIL** `pnpm plans:scope`. With `--base origin/main` it lists 8 plan files as out of
      scope. The cause is the plan's format, not unplanned code; see M2.
- [x] `pnpm check` passes. Turbo ran 19/19 tasks, mobile has 22 tests (17 in
      `tokens.test.ts`), and arch, plans:lint, harness, hooks and quality all pass.
- [x] Integration: N/A (no `infrastructure/` or schema change).
- [x] No business rules in UI. The screens only render the `useCompanies()` state.
- [x] CQRS-lite: N/A (no API change).
- [x] Contract types: nothing is redeclared, and `useCompanies` is unchanged.
- [x] Expected errors / `Result`: N/A.
- [x] Money/dates/Clock: N/A.
- [x] Schema/migration: N/A.
- [x] DI: N/A.
- [x] No secrets, `.env` contents or personal data. The only literal values are palette colors
      and the test hex values.
- [x] `## Deviations` exists. I spot-checked `maxFontSizeMultiplier={1.3}`
      (`app-tabs.tsx:86`) and the `interface` props, and both match. One claim is inaccurate;
      see L2.
- [ ] **FAIL** Docs. `plans/mobile-app-colaborador/README.md:58` says the tokens live in
      `apps/mobile/src/theme/tokens.ts`, but they live in `apps/mobile/src/constants/tokens.ts`
      (the plan's step 2); see L1.

Other checks that passed: `grep -rn explore apps/mobile/src` finds nothing. No hex color
literals are left outside `src/constants/`, except the template files `themed-text.tsx:66` and
`animated-icon.tsx:144` (the gradient), which the plan allows. The forwarding from
`Link asChild` to `Button` is correct: on native, `onPress` is destructured and passed on; on
web, `onClick`/`href` arrive through `...rest` (`expo-router/build/link/BaseExpoRouterLink.js:87-91`).
`useFonts` on the server returns `[true, null]`, so static web rendering does not return
`null`.

### High

None.

### Medium

- **M1: on devices with a bottom safe area, the dock hides the last item of the list.**
  - **Where:** `apps/mobile/src/constants/tokens.ts:144` (`DOCK_CLEARANCE`), used by
    `apps/mobile/src/app/empresas.tsx:69` and `apps/mobile/src/app/index.tsx:36`. The dock is
    placed in `apps/mobile/src/components/app-tabs.tsx:55`.
  - **What fails:** `DOCK_CLEARANCE` is 94 (64 + 14 + 16) and does not include
    `insets.bottom`. The dock, however, sits at `bottom: insets.bottom + DOCK.bottomGap`. Its
    real height is 60 (padding 6 + `minHeight` 48 + padding 6).
  - **Why nothing compensates:** `TabSlot` takes 100% of the height, and React Native's iOS
    `ScrollView` uses `contentInsetAdjustmentBehavior = Never` by default
    (`react-native/React/Fabric/.../RCTScrollViewComponentView.mm:432`). Nothing adds the inset
    automatically.
  - **Scenario:** on an iPhone with a home indicator (`insets.bottom` ≈ 34), the top of the dock
    is 34 + 14 + 60 = 108 pt above the bottom edge. Scrolled all the way down, the last
    Empresas tile ends 94 pt above the edge, so its bottom 14 pt stay under the dock. Android
    with edge-to-edge and gesture navigation has the same problem. On Expo web the inset is 0,
    so the verifier would not see it there.
  - **Acceptance criterion broken:** "The last tile is fully visible above the dock".
  - **Origin:** the plan's own definition (step 2). The implementer followed it exactly. The fix
    is to add `useSafeAreaInsets().bottom` to the padding on each screen, or to expose a hook
    or helper. Either way it changes the step 2 definition, so it must be recorded as a
    deviation.
- **M2: the plan's `Files:` lines break `pnpm plans:scope`.**
  - **Where:** this plan, steps 6, 7 and 8.
  - **What fails:** `declaredFiles` (`scripts/plans/lib.mjs:185-197`) only reads the paths on
    the same line as `Files:`. Steps 6–8 wrap the list onto later lines, so the scope check
    flags as out of scope `app.json`, `animated-icon.tsx`, `app-tabs.web.tsx`, `ui/button.tsx`,
    `ui/chip.tsx`, `ui/shell-header.tsx` and `ui/tile.tsx`. No step declares
    `apps/mobile/src/constants/tokens.test.ts` at all; plan 003 of attendance declares its
    tests in a step.
  - **Impact:** the scope check fails today and stays red at merge.
  - **Fix:** the main session or the architect amends the plan. Put each `Files:` list on a
    single line, as `docs/harness/conventions/plans.md:92-94` requires, and declare
    `tokens.test.ts` (create). This is not a code change.

### Low

- **L1: the series README is out of date.** `plans/mobile-app-colaborador/README.md:58` gives
  the token path as `src/theme/tokens.ts`. The plan chose `src/constants/tokens.ts` and
  explicitly rejected `src/theme/`. The next plan in the series (002) will read that README.
- **L2: one deviation is inaccurate.** The fourth Deviations bullet says `tokens.ts`,
  `contrast.ts` and `use-palette.ts` "are untracked and not yet in that report". In fact
  `scope.mjs:60` does include untracked files. The reported scope failure is also explained
  only by "earlier merged work". That is true only against the stale local `main`. Against
  `origin/main`, the real cause is M2.
- **L3: `TEXT_PAIRS` does not cover every pair used.**
  - **Where:** `apps/mobile/src/app/empresas.tsx:29`.
  - **What fails:** this line renders `danger` text on `surface` (the error tile), but
    `danger/surface` is not in `TEXT_PAIRS` (`tokens.ts:96-117`). The token docblock says a new
    pair is added there before it is used.
  - **Impact:** today it passes, by my calculation about 5.9:1 in light and above 4.5 in dark,
    but no test guards it. Step 10 of the plan itself asks for this pair.
- **L4: `DOCK.height` (64) is not applied to the dock.** `app-tabs.tsx:95-101` does not set
  a height, so the real height is 60. The token and the actual dock can drift apart. It is
  harmless today, but M1 shows the clearance calculation depends on it.
- Informational, not a finding: `apps/mobile/package.json` reorders `dependencies` and
  `devDependencies` alphabetically, a side effect of the `expo install`/`pnpm add` in step 1.
  No version changes besides the two font packages.

Result: two medium findings. M1 needs a code change (and a deviation). M2 needs an edit to the
plan. Status stays `review`.

### Re-review 2026-11-10 (after the review-fix round)

Diff again compared against `origin/main` (edad282); nothing is committed yet.

#### Checklist: 13/13 (N/A items count as passed)

- [x] `pnpm plans:scope ... --base origin/main`: 20 declared, 23 changed. The only file flagged is
      `docs/referencia/buk-portal-colaborador.md`, which is earlier untracked work by the user,
      not part of this plan and untouched by it. Every file of the plan is now in scope, including
      both test files. Treated as passed for this plan.
- [x] `pnpm check` passes: format, turbo 19/19 tasks, mobile 3 files / 30 tests, arch,
      plans:lint, harness, hooks, bootstrap and quality.
- [x] Integration, CQRS, contracts, `Result`, Money/dates, schema, DI: N/A (no API change).
- [x] No business rules in UI; no secrets or personal data.
- [x] `## Deviations` is honest. Spot-checked the M1 entry (`use-palette.ts:17-19`, used in
      `index.tsx:12` and `empresas.tsx:14`) and the L4 entry (`app-tabs.tsx:98`); both match.
- [x] Docs: `plans/mobile-app-colaborador/README.md:57` now gives
      `apps/mobile/src/constants/tokens.ts`.

#### Fixes verified

- **M1, resolved.** `useDockClearance()` returns `DOCK_CLEARANCE + useSafeAreaInsets().bottom`.
  With the dock at `bottom: insets.bottom + 14` and `height: 64`, its top sits at
  `insets.bottom + 78`, and the list's bottom padding is `insets.bottom + 94`, so the last tile
  stays 16 pt above the dock for any inset. Both scrollable screens use the hook; nothing else
  still uses the bare `DOCK_CLEARANCE`. `useSafeAreaInsets` needs a `SafeAreaProvider`;
  `expo-router`'s `ExpoRoot` provides it, and the dock and `ShellHeader` already relied on that.
  The loading and error states are not scrollable and sit at the top, so they need no clearance.
- **M2, resolved.** Every `Files:` list is on one line; steps 3 and 5 declare `tokens.test.ts`
  and `use-palette.test.tsx`.
- **L1, resolved.** The README path is corrected.
- **L2, resolved.** The plans:scope deviation now names the real cause.
- **L3, resolved.** `['danger', 'surface']` is in `TEXT_PAIRS` (`tokens.ts:116`); the AA test
  covers it in light and dark, plus a dedicated test.
- **L4, resolved.** The dock sets `height: DOCK.height`. Its content box is 52 (64 minus padding
  6+6), so the 48-minimum buttons fit. The tallest label (13 × 1.3 ≈ 17) plus the 20 icon and
  the gap of 2 comes to about 39, so nothing clips even at the font cap.

#### Regression hunt

No new findings. Checked:

- The `vi.mock` of `@/constants/theme` → `tokens` in `use-palette.test.tsx` is safe, because
  `theme.ts` re-exports the same objects. The test compares by identity (`toBe(PALETTE[...])`).
- `grep -rn explore apps/mobile/src` finds nothing. The only hex literals outside
  `src/constants/` are still `themed-text.tsx:66` and `animated-icon.tsx:144`, both allowed.

Informational, not a finding: `useDockClearance` lives in `use-palette.ts`, a file named for a
different concern. This is within the declared file list and works correctly; a later plan could
move it.

Result: all findings resolved, and no new findings. Status moves to `verify`. The verifier
should still confirm on a device with a real bottom inset; web has an inset of 0 (see Test
coverage, NOT CONFIRMED rows).

### Re-review 2026-11-10 (verification repair: `aria-*` instead of `accessibilityState`)

Scope of this round: only the repair in `components/app-tabs.tsx` and `components/ui/button.tsx`.
Diff compared against `origin/main` (edad282). Checked against the installed packages:
react-native 0.86.3, react-native-web 0.21.2, expo-router 57.0.23.

#### Checklist: 12/13 (N/A items count as passed)

- [ ] `pnpm plans:scope ... --base origin/main`: 20 declared, 24 changed. Two files are flagged.
      `docs/referencia/buk-portal-colaborador.md` is known user work, as before. The new one is
      `apps/mobile/.gitignore` (see L2 below).
- [x] `pnpm check` passes. Turbo ran 19/19 tasks; mobile has 30 tests. Arch, plans:lint, harness,
      hooks, bootstrap and quality all pass. `@rrhh/api:lint` has 2 warnings, which predate this
      plan and are outside it.
- [x] Integration, CQRS, contracts, `Result`, Money/dates, schema, DI: N/A.
- [x] No business rules in UI; no secrets or personal data.
- [x] `## Deviations` names the repair. The prop names it cites are correct: `aria-busy`,
      `aria-disabled` and `aria-selected` are `boolean` in
      react-native `Libraries/Components/View/ViewAccessibility.d.ts:55-59`. Its claim that
      `aria-disabled` reaches the DOM on web is wrong; see L1.
- [x] Docs: nothing else describes this.

#### Checked and correct

- **`aria-selected` (dock tabs).** It is not in react-native-web `Pressable`'s excluded props,
  so it passes through `rest` to `View`. `createDOMProps` (`dist/modules/createDOMProps/index.js:673-675`)
  then writes `aria-selected`. `Boolean(isFocused)` gives `"true"` or `"false"` on every tab.
- **`aria-busy` (Button).** It follows the same path (`createDOMProps` `:206-208`). With
  `loading=false` it always renders `aria-busy="false"`, which is harmless.
- **`accessibilityRole` still gives a `role`.** `propsToAriaRole` uses `role || accessibilityRole`
  (`dist/modules/AccessibilityUtil/propsToAriaRole.js:27`), and `createDOMProps:608-610` writes
  it. The dock tabs get `role="tab"`, because `TabTriggerSlotProps` brings no `role`.
  "Ver empresas" still gets `role="link"` from `Link asChild`, as the second run saw. The only
  effect of the change is a dev-only deprecation `warnOnce`, which is not a finding.
- **No remaining `accessibilityState`.** `grep -rn accessibilityState apps/mobile/src` finds
  nothing. `chip.tsx` and `tile.tsx` never used it.
- **Native semantics are unchanged.** react-native's `Pressable.js:227-236` builds
  `accessibilityState` from `aria-busy`, `aria-disabled` and `aria-selected`, falling back to
  `accessibilityState`, so iOS and Android get the same state as before. Presses are blocked
  only by the `disabled` prop (`Pressable.js:198,266`). Neither the old nor the new code passes
  it; both rely on `onPress={inactive ? undefined : onPress}`, which still holds. The repair
  adds no regression.

#### Low

- **L1 (needs a code change): `aria-disabled` on `Button` is never rendered on web.**
  - **Where:** `apps/mobile/src/components/ui/button.tsx:41-47`.
  - **Why:** react-native-web's `Pressable` (`dist/exports/Pressable/index.js:124-125`) spreads
    `rest`, then sets `"aria-disabled": disabled`, where `disabled` is `props.disabled`. That
    overwrites the `aria-disabled={inactive}` we pass with `undefined`, so `createDOMProps`
    (`:155,314-315`) never writes it.
  - **Scenario:** a `Button` with `disabled` or `loading` (for example a future "Reintentar"
    while it reloads) shows at 0.45 opacity. A screen reader still announces it as an active
    button, and it stays in the tab order with `tabIndex=0`. The repair does not fix this
    half of the verifier's report.
  - **Impact today:** none, because no current caller passes `disabled` or `loading`
    (`index.tsx:29`, `empresas.tsx:30`).
  - **Suggested fix, for the implementer:** pass `disabled={inactive}` to the `Pressable`.
    - On web, this yields `aria-disabled="true"` and `tabIndex=-1`.
    - On native, `Pressable` merges it into `accessibilityState` and blocks presses. That also
      covers `onLongPress`/`onPressIn` from `Link asChild`, which `onPress={undefined}` alone
      does not.
  - **Certainty:** read from the shipped `dist` source, not observed in a browser (no
    `Button` on screen is disabled).
- **L2 (no code change): `apps/mobile/.gitignore` is outside the plan.**
  - **What:** the file is untracked. Its content is the block expo-cli generates (`@generated
expo-cli sync-…`, ignoring `expo-env.d.ts`). Its mtime, 13:50, is before the repair
    (14:06), so the verification's `expo start --web` most likely created it. That is
    uncertain.
  - **Why it matters:** it makes `plans:scope` fail.
  - **Not deleted.** The main session or the user decides: declare it in the plan with a
    deviation, or leave it out of the plan's commits.

Result: one low finding needs a code change (L1), so the status stays `review`. After L1 is
fixed, the verifier should check the dock's `aria-selected` on web as planned. It should also
check `aria-disabled="true"` on a disabled or loading `Button`, if one can be put on screen.

### Re-review 2026-11-10 (L1 fix: `disabled={inactive}` on `Button`)

Scope of this round: the L1 fix in `components/ui/button.tsx` and the updated `## Test coverage`.
Diff compared against `origin/main`. Checked against the installed react-native 0.86.3,
react-native-web 0.21.2 and expo-router 57.0.23.

#### Checklist: 13/13 (N/A items count as passed)

- [x] `pnpm plans:scope ... --base origin/main`: 20 declared, 24 changed. It flags
      `apps/mobile/.gitignore` and `docs/referencia/buk-portal-colaborador.md`. The main session
      decided both are known out-of-plan files that stay out of the plan's commits, so this
      counts as passed. L2 is closed by that decision.
- [x] `pnpm check` passes when the reviewer ran it: turbo 19/19, mobile 30 tests, api 1418
      passed and 5 skipped, contracts 389, domain 98. Arch, plans:lint, harness, hooks, bootstrap
      and quality all pass. The 2 `@rrhh/api:lint` warnings predate this plan.
- [x] Integration, CQRS, contracts, `Result`, Money/dates, schema, DI: N/A.
- [x] No business rules in UI; no secrets or personal data.
- [x] `## Deviations` describes the fix correctly. It says that it supersedes the `aria-disabled`
      part of the earlier repair entry. `## Test coverage` has a new round with the `Button`
      rows marked NOT CONFIRMED and the reason no test was added. That reason is valid: there is
      no RN renderer in the mobile vitest setup.
- [x] `grep -rn "aria-disabled\|accessibilityState" apps/mobile/src` finds nothing.

#### Checked and correct

- **Web (react-native-web `dist/exports/Pressable/index.js`).** `disabled` is in `_excluded`
  (`:14`), so `rest` can no longer override it. The `View` gets `"aria-disabled": disabled`
  (`:125`), and `createDOMProps` (`:155,314-315`) writes `aria-disabled="true"`. `tabIndex` is
  `-1` when disabled (`:118-122`), because neither `Button` nor expo-router's `Link` passes a
  `tabIndex`. `usePressEvents` and `useHover` receive `disabled` (`:57-75`), so presses and hover
  are blocked. L1 is fixed.
- **Native (react-native `Libraries/Components/Pressable/Pressable.js`).**
  `_accessibilityState` takes `disabled` whenever the prop is not null (`~:233-234`), so a
  disabled or loading `Button` is reported as disabled. `aria-busy` still maps to `busy`
  (`~:228`). Pressability gets `disabled` in its config, which blocks `onPress`, `onLongPress`
  and `onPressIn` together. This includes handlers that `Link asChild` injects.
- **No regression in `Button`.**
  - The press guard `onPress={inactive ? undefined : onPress}` is still there. It is now
    redundant with `disabled`, which is harmless.
  - `aria-busy={loading}` is unchanged.
  - Opacity 0.45 and the press scale still depend on `inactive` and are unchanged. On web the
    `Pressable` also adds `styles.disabled` (`pointerEvents: 'box-none'`) and drops
    `cursor: pointer` when disabled. That matches a disabled button.
  - `disabled={inactive}` comes after `{...rest}`, so a `disabled` that a parent `Link` might
    inject cannot re-enable the button.
  - **Inicio:** `<Link href="/empresas" asChild><Button variant="secondary" title="Ver empresas" /></Link>`
    (`app/index.tsx:28-30`) never passes `disabled` or `loading`. `inactive` is `false`, so
    `disabled={false}` behaves exactly as before. On native it now sets
    `accessibilityState.disabled=false` explicitly, which is equivalent. `href`, `role` and the
    `onPress` that `Link` injects still reach the `Pressable` through `rest` and `onPress`.
    "Reintentar" in `empresas.tsx:30` is unaffected for the same reason.

#### Findings

None.

Result: clean, so the status moves to `verify`. The verifier should re-run the a11y check:
`aria-selected` on the dock tabs on Expo web, and that "Ver empresas" still navigates. It should
also check `aria-disabled="true"` with `tabindex="-1"` on a disabled or loading `Button`, but
only if one can be put on screen. Today none can, so that row stays NOT CONFIRMED.

## Verification

### Partial run — 2026-11-10 (main session, inline). Status stays `verify`.

#### Suites

- **`pnpm check`: green.**
  - `Tasks: 19 successful, 19 total`.
  - `@rrhh/mobile:test: Tests 30 passed (30)`.
  - `plans:lint` ✔.
  - harness/bootstrap/quality: `pass 161 / 17 / 9`, `fail 0`.
- **`pnpm --filter @rrhh/mobile exec expo export --platform android`: bundles.**
  - `Android Bundled 17212ms … (1767 modules)`.
  - The IBM Plex Sans and Mono `.ttf` assets are included.
- **Observation, not a failure.** The bundle ships all 28 IBM Plex faces (every weight and
  italic, about 5 MB), because the font packages' index requires them all. The app uses only 7
  faces. The fix is to import from per-weight entry points; it is left for a later plan, not
  this one.

#### Running app

- Setup: Expo web (`expo start --web --port 8081`), `pnpm dev:api` on `:3000`, desktop Chrome
  with the OS in dark mode.
- **Fonts:** computed `font-family` values on rendered text are `IBMPlexSans_400Regular`,
  `IBMPlexSans_500Medium`, `IBMPlexSans_600SemiBold`, `IBMPlexMono_500Medium` (labels) and
  `MaterialSymbols_400Regular` (dock icons). `document.fonts` reports the same faces as
  `loaded`.
- **Inicio:** dark header with "RRHH APS / Inicio", the "Próximamente" tile and the "Ver
  empresas" button. Tapping the button navigates to `/empresas`.
- **Dock:** a dark rounded bar at the bottom with "Inicio" and "Empresas". The focused tab has
  the lighter background and the cyan icon, and switching tabs changes the screen.
- **Empresas, error path with the API unreachable:**
  - The mobile `.env` points to `localhost:3001`, so the request fails with status 0.
  - The screen shows the error tile "No se pudo cargar el listado: No se pudo conectar con el
    API." in danger color, with the primary "Reintentar" button (cyan in dark mode, dark text).
  - The `.env` was not read or edited. The port mismatch is local configuration, outside this
    plan.
- **Empresas, error path with the API up:**
  - Restarted with `EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1` on the command line, not
    in `.env`.
  - The API answers `401 {"code":"AUTHENTICATION_REQUIRED"}` with
    `Access-Control-Allow-Origin: http://localhost:8081` (checked with curl).
  - The list needs a signed-in user, which is plan 002's job.

#### NOT VERIFIED

The Chrome extension disconnected mid-run, so these items are still open:

- the Empresas success state (tiles, mono tax ID, Activa/Inactiva chip) and the last tile
  clearing the dock at phone width;
- the light palette (the OS was in dark mode);
- press feedback (scale 0.97);
- on a device (Expo Go): the `#0A2226` splash, the dock above a real bottom safe area at
  height 64, and the last tile clearing the dock (M1).

#### Acceptance criteria

- [x] `pnpm check` passes.
- [~] Petrol splash and IBM Plex text: fonts verified on web. The splash is NOT VERIFIED (it
  needs a device).
- [x] Dock with Inicio and Empresas and a marked focused tab, on web. Native is NOT VERIFIED.
- [x] Inicio with the dark header, the "Próximamente" tile, and a button that opens Empresas.
- [~] Empresas: the error tile and "Reintentar" are verified. The tile list and dock clearance
  are NOT VERIFIED (they need a signed-in user or a mocked response).
- [~] Dark appearance verified on web. The light appearance is NOT VERIFIED.
- [ ] Press feedback: NOT VERIFIED.
- [x] No hex literals outside `src/constants/`, except the allowed template files (reviewer
      grep, re-review 2026-11-10).

### Second run — 2026-11-10 (main session, inline, Chrome reconnected). Status stays `verify`.

Setup:

- Expo web on `:8081` with `EXPO_PUBLIC_API_URL` passed on the command line, not in `.env`.
- The app runs in same-origin iframes 390×760 px, so it renders at phone width.
- Mocking `fetch` in the page does not work: the api-client keeps its own `fetch` reference
  (the request still reached the real API and returned `AUTHENTICATION_REQUIRED`).
- So the success state was driven against a throwaway fake API on `:3010`
  (`/tmp/claude-1000/-home-jonylinux-codes-web-rh/a168ce25-1710-452e-bf4c-87eb82ce73db/scratchpad/mock-api/server.mjs`).
  It returns a `Page<CompanyDto>` of 12 invented companies (MX/DO/CO, 3 inactive), with no
  personal data.

Observed:

- **Empresas, success, phone width.** Each company is a tile:
  - `legalName` in IBM Plex Sans medium;
  - tax ID and country in IBM Plex Mono uppercase (`ASC010203AB1 · MX`, `130123456 · DO`);
  - an `Activa` chip (success colors) or an `Inactiva` chip (neutral).

  The page parses through the real api-client.

- **Dock clearance on web (bottom inset 0).** Scrolled to the end, the last tile ("…SA de CV
  12") sits fully above the dock, with a gap. The device case with a real inset is still NOT
  VERIFIED.
- **Dock metrics.** The dock `getBoundingClientRect().height` is `64` (`DOCK.height`). Each tab
  is `52` tall, above the 48 minimum. The "Ver empresas" button is `48`.
- **Press feedback.** On the "Ver empresas" button (rendered as `<a role="link">` via
  `Link asChild`), `transform` is `none` at rest and `matrix(0.97, 0, 0, 0.97, 0, 0)` while
  the pointer is down.

**FAIL (low, accessibility, web): the dock tabs do not expose the selected state.**

- **Rendered:** `Inicio role=tab tabindex=0`, `Empresas role=tab tabindex=0`. There is no
  `aria-selected` on either tab, although Inicio is the focused route.
- **Source:** `apps/mobile/src/components/app-tabs.tsx:73-74` passes `accessibilityRole="tab"`
  and `accessibilityState={{ selected }}`. On react-native-web 0.21 the role is mapped, but
  `accessibilityState` is not rendered as `aria-*`.
- **Same pattern:** `apps/mobile/src/components/ui/button.tsx:46`
  (`accessibilityState={{ disabled, busy }}`) presumably has the same gap on web. Not observed
  directly.
- **Native:** not checked (no device).
- **Proposed repair:** the implementer uses the cross-platform `aria-selected`,
  `aria-disabled` and `aria-busy` props instead of `accessibilityState`; review then re-checks.

**Still NOT VERIFIED:**

- **The light palette.** Forcing `prefers-color-scheme` from JS re-rendered only part of the
  tree (tiles and buttons turned light, the screen background stayed dark), so it is not valid
  evidence. It needs the OS or Chrome set to light.
- **Device-only items:** the splash `#0A2226`, the dock over a real bottom safe area, and
  native fonts and press feedback.

Acceptance criteria after the second run:

- [x] Empresas tiles with a mono tax ID, Activa/Inactiva chips, and the last tile clear of the
      dock (web, inset 0).
- [x] Press feedback: scale 0.97 on the "Ver empresas" button (web).
- [x] Dock with a marked focused tab, visually. Its selected state is not exposed to assistive
      tech on web (FAIL above).
- [ ] Light appearance: NOT VERIFIED.
- [ ] Device items (splash, real safe area): NOT VERIFIED.

### Third run — 2026-11-10 (main session, inline), after the a11y repair and L1 fix

Supersedes the second run's FAIL, for `app-tabs.tsx` and `ui/button.tsx` only.

Setup: same as the second run, at phone width (390 px iframes) against the fake API on
`:3010`. The re-review's `pnpm check` was green (19/19 tasks, mobile 30, fail 0).

Observed:

- **Dock tabs expose the selected state on web.** On `/` the tabs render
  `Inicio aria-selected=true` and `Empresas aria-selected=false`. On `/empresas` the values
  are reversed.
- **"Ver empresas" is unchanged.** It renders `<a role="link" href="/empresas" tabindex="0">`
  with no `aria-disabled`. Clicking it navigates to `/empresas`, and the dock selection follows
  (`Inicio=false`, `Empresas=true`).
- **Empresas success list renders as in the second run:** tiles, mono tax ID, Activa/Inactiva
  chips.

NOT VERIFIED (unchanged):

- A disabled or loading `Button` rendering `aria-disabled="true"` and `tabindex=-1`. No
  `Button` on any screen can be disabled or loading yet. The re-review confirmed this from the
  react-native-web and react-native sources.
- The light palette. Chrome and the OS were still dark (`prefers-color-scheme: dark` is
  `true`).
- Device-only items: the `#0A2226` splash, the dock above a real bottom safe area, and native
  fonts and press feedback.

Cleanup: the fake API, Expo web and the dev API started for this verification were stopped.
`apps/mobile/.gitignore` was generated by `expo start`; it stays out of the plan's commits.

Result: every acceptance criterion that can be checked on web passes. The open items are the
light appearance and the device-only checks. **Ready for the user to decide on `done`.**
