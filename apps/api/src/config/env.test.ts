import { describe, expect, it } from 'vitest';

import { loadEnv } from './env';

const base = { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' };

describe('loadEnv — ZKTECO_ALLOWED_SERIALS', () => {
  it('transforma una lista separada por comas en un arreglo recortado', () => {
    const env = loadEnv({ ...base, ZKTECO_ALLOWED_SERIALS: 'A1, B2' });

    expect(env.ZKTECO_ALLOWED_SERIALS).toEqual(['A1', 'B2']);
  });

  it('produce un arreglo vacío cuando la variable no está definida', () => {
    const env = loadEnv({ ...base });

    expect(env.ZKTECO_ALLOWED_SERIALS).toEqual([]);
  });

  it('descarta segmentos vacíos', () => {
    const env = loadEnv({ ...base, ZKTECO_ALLOWED_SERIALS: 'A1,,B2,' });

    expect(env.ZKTECO_ALLOWED_SERIALS).toEqual(['A1', 'B2']);
  });
});
