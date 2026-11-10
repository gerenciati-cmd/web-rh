/** Tokens visuales compartidos de mobile; no contienen reglas de negocio. */

import '@/global.css';

import { Platform } from 'react-native';

import { FONT_FAMILY, PALETTE } from './tokens';

export { DOCK, DOCK_CLEARANCE, FONT_FAMILY, PALETTE, RADIUS } from './tokens';
export type { PaletteKey, Scheme } from './tokens';

/** Claves heredadas de la plantilla, mapeadas sobre la paleta "Caribe". */
export const COLORS = {
  light: {
    text: PALETTE.light.ink,
    background: PALETTE.light.paper,
    backgroundElement: PALETTE.light.sunk,
    backgroundSelected: PALETTE.light.line,
    textSecondary: PALETTE.light.ink2,
  },
  dark: {
    text: PALETTE.dark.ink,
    background: PALETTE.dark.paper,
    backgroundElement: PALETTE.dark.sunk,
    backgroundSelected: PALETTE.dark.line,
    textSecondary: PALETTE.dark.ink2,
  },
} as const;

export type ThemeColor = keyof typeof COLORS.light;

/** Mismas familias en toda plataforma: IBM Plex se carga en runtime con `useFonts`. */
export const FONTS = {
  sans: FONT_FAMILY.sans.regular,
  serif: FONT_FAMILY.sans.regular,
  rounded: FONT_FAMILY.sans.regular,
  mono: FONT_FAMILY.mono.regular,
};

export const SPACING = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BOTTOM_TAB_INSET = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MAX_CONTENT_WIDTH = 800;
