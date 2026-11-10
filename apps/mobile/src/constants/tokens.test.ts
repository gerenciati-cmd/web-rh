import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio, relativeLuminance } from './contrast';
import { DOCK, DOCK_CLEARANCE, FONT_FAMILY, PALETTE, TEXT_PAIRS } from './tokens';

const require = createRequire(import.meta.url);

describe('contrastRatio', () => {
  it('da 21 para negro sobre blanco', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('da 1 para un color contra sí mismo', () => {
    expect(contrastRatio('#36B0C9', '#36B0C9')).toBeCloseTo(1, 5);
  });

  it('da cerca de 2.56 para el acento sobre blanco (valor del plan)', () => {
    expect(contrastRatio('#36B0C9', '#FFFFFF')).toBeCloseTo(2.56, 1);
  });

  it('es simétrico respecto al orden de los colores', () => {
    expect(contrastRatio('#004750', '#F6F5F1')).toBeCloseTo(
      contrastRatio('#F6F5F1', '#004750'),
      10,
    );
  });

  it('acepta minúsculas', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it.each(['#FFF', 'FFFFFF', 'rgba(255,255,255,0.08)', '#GGGGGG', ''])(
    'rechaza el formato inválido %j con un mensaje en español',
    (value) => {
      expect(() => relativeLuminance(value)).toThrow(/Color inválido/);
      expect(() => contrastRatio(value, '#FFFFFF')).toThrow(/Color inválido/);
    },
  );
});

describe('PALETTE', () => {
  it('tiene las mismas claves en light y dark', () => {
    expect(Object.keys(PALETTE.dark).sort()).toEqual(Object.keys(PALETTE.light).sort());
  });

  it.each(['light', 'dark'] as const)(
    'cumple AA (4.5) en todos los pares de texto en %s',
    (scheme) => {
      const palette = PALETTE[scheme];
      const failing = TEXT_PAIRS.map(([fg, bg]) => ({
        pair: `${fg}/${bg}`,
        ratio: contrastRatio(palette[fg], palette[bg]),
      })).filter((entry) => entry.ratio < 4.5);
      expect(failing).toEqual([]);
    },
  );

  it('incluye danger/surface, el par del tile de error de Empresas', () => {
    expect(TEXT_PAIRS).toContainEqual(['danger', 'surface']);
  });

  it('solo declara pares con claves existentes y sin repetidos', () => {
    const keys = new Set(Object.keys(PALETTE.light));
    for (const [fg, bg] of TEXT_PAIRS) {
      expect(keys.has(fg)).toBe(true);
      expect(keys.has(bg)).toBe(true);
    }
    const unique = new Set(TEXT_PAIRS.map(([fg, bg]) => `${fg}/${bg}`));
    expect(unique.size).toBe(TEXT_PAIRS.length);
  });
});

describe('DOCK', () => {
  it('DOCK_CLEARANCE cubre la altura, la separación inferior y 16 de aire', () => {
    expect(DOCK_CLEARANCE).toBe(DOCK.height + DOCK.bottomGap + 16);
  });
});

describe('FONT_FAMILY', () => {
  const faces = [
    ['ibm-plex-sans', Object.values(FONT_FAMILY.sans)],
    ['ibm-plex-mono', Object.values(FONT_FAMILY.mono)],
  ] as const;

  it.each(faces)(
    'cada nombre existe como fuente del paquete @expo-google-fonts/%s',
    (pkg, names) => {
      const root = dirname(require.resolve(`@expo-google-fonts/${pkg}/package.json`));
      for (const name of names) {
        // El paquete publica cada cara en `<peso>/<Familia>_<peso>.ttf`.
        const weight = name.slice(name.indexOf('_') + 1);
        expect(existsSync(join(root, weight, `${name}.ttf`)), name).toBe(true);
      }
    },
  );
});
