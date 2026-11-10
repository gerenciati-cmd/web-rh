import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DOCK_CLEARANCE, PALETTE } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Paleta "Caribe" del esquema activo; `unspecified` (o ausente) se trata como claro. */
export function usePalette() {
  const scheme = useColorScheme();

  return PALETTE[scheme === 'dark' ? 'dark' : 'light'];
}

/**
 * Padding inferior que necesita una pantalla con scroll para que su último elemento no quede bajo
 * el dock: el dock flota sobre el inset inferior, así que ese inset se suma a `DOCK_CLEARANCE`.
 */
export function useDockClearance() {
  return DOCK_CLEARANCE + useSafeAreaInsets().bottom;
}
