/**
 * Tokens visuales puros de la dirección "Caribe". No importan `react-native` para poder
 * probarse con vitest sin renderer nativo.
 */

/**
 * Paleta por esquema. Las claves son idénticas en `light` y `dark`; el color se lee por rol
 * (superficie, tinta, acento…) y nunca por valor, para que el modo oscuro sea solo otra tabla.
 */
export const PALETTE = {
  light: {
    /** Fondo de pantalla. */
    paper: '#F6F5F1',
    /** Superficie de tarjetas y tiles. */
    surface: '#FFFFFF',
    /** Superficie hundida (campos, chips neutros). */
    sunk: '#EEECE6',
    /** Bordes y separadores. */
    line: '#E4E1D9',
    /** Texto principal. */
    ink: '#0F1F22',
    /** Texto secundario. */
    ink2: '#44524F',
    /** Texto terciario (etiquetas). */
    ink3: '#5F6965',
    /** Fondo del header y del dock (siempre oscuro). */
    shell: '#0A2226',
    /** Texto principal sobre `shell`. */
    onShell: '#EEF1EC',
    /** Texto secundario sobre `shell`. */
    onShell2: '#9FB3B1',
    /** Color de marca para acciones primarias. */
    primary: '#004750',
    /** Texto sobre `primary`. */
    onPrimary: '#FFFFFF',
    /** Acento decorativo (íconos; no apto para texto sobre claro). */
    accent: '#36B0C9',
    /** Acento apto para texto. */
    accentText: '#0B7088',
    /** Arena decorativa. */
    sand: '#D9B47A',
    /** Texto en arena. */
    sandText: '#7A5418',
    /** Fondo suave de arena. */
    sandSoft: '#F3EBDD',
    /** Estado correcto. */
    success: '#1F7A45',
    /** Fondo del estado correcto. */
    successBg: '#E6F3EA',
    /** Estado de advertencia. */
    warning: '#9A5B0B',
    /** Fondo de advertencia. */
    warningBg: '#FBF0DC',
    /** Estado de error. */
    danger: '#B4363F',
    /** Fondo de error. */
    dangerBg: '#F9E5E6',
    /** Fondo de la pestaña activa del dock. */
    dockActive: 'rgba(255,255,255,0.08)',
  },
  dark: {
    paper: '#0A1314',
    surface: '#121D1F',
    sunk: '#172629',
    line: '#23302F',
    ink: '#EEF1EC',
    ink2: '#B5BFBB',
    ink3: '#85918D',
    shell: '#050C0D',
    onShell: '#EEF1EC',
    onShell2: '#9FB3B1',
    primary: '#36B0C9',
    onPrimary: '#04252A',
    accent: '#36B0C9',
    accentText: '#5FCBE0',
    sand: '#E2C08A',
    sandText: '#E2C08A',
    sandSoft: '#2A2316',
    success: '#5FC98A',
    successBg: '#12352A',
    warning: '#E5A94A',
    warningBg: '#3A2C12',
    danger: '#F0817F',
    dangerBg: '#3E1E22',
    dockActive: 'rgba(255,255,255,0.08)',
  },
} as const;

export type PaletteKey = keyof typeof PALETTE.light;
export type Scheme = 'light' | 'dark';

/**
 * Pares [texto, fondo] permitidos para texto en la UI; el test exige contraste WCAG AA (4.5)
 * en ambos esquemas. Un par nuevo se agrega aquí antes de usarse.
 */
export const TEXT_PAIRS: readonly (readonly [PaletteKey, PaletteKey])[] = [
  ['ink', 'paper'],
  ['ink', 'surface'],
  ['ink', 'sunk'],
  ['ink2', 'paper'],
  ['ink2', 'surface'],
  ['ink2', 'sunk'],
  ['ink3', 'paper'],
  ['ink3', 'surface'],
  ['ink3', 'sunk'],
  ['onShell', 'shell'],
  ['onShell2', 'shell'],
  ['onPrimary', 'primary'],
  ['accentText', 'paper'],
  ['accentText', 'surface'],
  ['accentText', 'sunk'],
  ['sandText', 'surface'],
  ['sandText', 'sandSoft'],
  ['success', 'successBg'],
  ['warning', 'warningBg'],
  ['danger', 'dangerBg'],
  ['danger', 'surface'],
];

/** Radios de esquina por tamaño de superficie. */
export const RADIUS = { xs: 6, sm: 8, md: 12, lg: 18, sheet: 22, pill: 999 } as const;

/**
 * Familias IBM Plex. Cada peso es un nombre de familia propio (así los registra
 * `@expo-google-fonts`), por eso los componentes fijan `fontFamily` y nunca `fontWeight`.
 */
export const FONT_FAMILY = {
  sans: {
    regular: 'IBMPlexSans_400Regular',
    medium: 'IBMPlexSans_500Medium',
    semibold: 'IBMPlexSans_600SemiBold',
    bold: 'IBMPlexSans_700Bold',
  },
  mono: {
    regular: 'IBMPlexMono_400Regular',
    medium: 'IBMPlexMono_500Medium',
    semibold: 'IBMPlexMono_600SemiBold',
  },
} as const;

/** Métricas del dock flotante. */
export const DOCK = { height: 64, sideInset: 14, bottomGap: 14 } as const;

/** Relleno inferior que necesita una pantalla con scroll para que el dock no tape su último elemento. */
export const DOCK_CLEARANCE = DOCK.height + DOCK.bottomGap + 16;
