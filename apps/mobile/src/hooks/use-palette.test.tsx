import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DOCK_CLEARANCE, PALETTE } from '@/constants/tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { useDockClearance, usePalette } from './use-palette';

// `theme.ts` importa react-native y global.css, que vitest no puede cargar: se sustituye por los
// tokens puros que re-exporta. Los módulos nativos se simulan; el comportamiento real en
// dispositivo lo cubre el verificador.
vi.mock('@/constants/theme', async () => await import('@/constants/tokens'));
vi.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: vi.fn() }));
const insets = vi.hoisted(() => ({ bottom: 0 }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: insets.bottom }),
}));

const scheme = vi.mocked(useColorScheme);
afterEach(cleanup);
beforeEach(() => {
  insets.bottom = 0;
  scheme.mockReset();
});

describe('useDockClearance', () => {
  it('sin inset inferior devuelve DOCK_CLEARANCE', () => {
    const { result } = renderHook(useDockClearance);
    expect(result.current).toBe(DOCK_CLEARANCE);
  });

  it('suma el inset inferior de la zona segura a DOCK_CLEARANCE', () => {
    insets.bottom = 34;
    const { result } = renderHook(useDockClearance);
    expect(result.current).toBe(DOCK_CLEARANCE + 34);
  });
});

describe('usePalette', () => {
  it.each([
    ['dark', 'dark'],
    ['light', 'light'],
    ['unspecified', 'light'],
    [null, 'light'],
    [undefined, 'light'],
  ] as const)('esquema %s resuelve la paleta %s', (value, expected) => {
    scheme.mockReturnValue(value as never);
    const { result } = renderHook(usePalette);
    expect(result.current).toBe(PALETTE[expected]);
  });
});
