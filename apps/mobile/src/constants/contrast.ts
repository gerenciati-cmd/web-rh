/** Contraste WCAG 2.x para validar la paleta; sin dependencias de `react-native`. */

const HEX6 = /^#[0-9a-fA-F]{6}$/;

function linearChannel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa de un color `#RRGGBB`. */
export function relativeLuminance(hex: string): number {
  if (!HEX6.test(hex)) {
    throw new Error(`Color inválido "${hex}": se espera el formato #RRGGBB.`);
  }
  const r = linearChannel(parseInt(hex.slice(1, 3), 16));
  const g = linearChannel(parseInt(hex.slice(3, 5), 16));
  const b = linearChannel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste entre dos colores `#RRGGBB` (1 a 21). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
