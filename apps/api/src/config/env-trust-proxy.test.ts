import { describe, expect, it } from 'vitest';

import { loadEnv } from './env';

const base = { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' };

// Plan attendance-marcaciones/005: `TRUST_PROXY` alimenta el `trust proxy` de Express, del que
// depende la barrera de red de /iclock (y el throttle de login) al leer `req.ip`.
describe('loadEnv: TRUST_PROXY', () => {
  it('ausente: false (se usa la IP del socket, el comportamiento anterior)', () => {
    expect(loadEnv({ ...base }).TRUST_PROXY).toBe(false);
  });

  it.each(['', '   '])('la cadena %j (línea vacía de .env.example) equivale a false', (value) => {
    expect(loadEnv({ ...base, TRUST_PROXY: value }).TRUST_PROXY).toBe(false);
  });

  it.each([
    ['1', 1],
    ['2', 2],
    [' 3 ', 3],
    ['0', 0],
  ])('el entero %j son %d saltos', (value, hops) => {
    expect(loadEnv({ ...base, TRUST_PROXY: value }).TRUST_PROXY).toBe(hops);
  });

  it('una lista de IPs/CIDR separadas por coma se recorta y pasa como arreglo', () => {
    const env = loadEnv({ ...base, TRUST_PROXY: ' 10.0.0.1 , 172.16.0.0/12,,192.168.1.0/24 ' });

    expect(env.TRUST_PROXY).toEqual(['10.0.0.1', '172.16.0.0/12', '192.168.1.0/24']);
  });

  it('una sola IP queda como arreglo de un elemento (no como entero)', () => {
    expect(loadEnv({ ...base, TRUST_PROXY: '10.0.0.1' }).TRUST_PROXY).toEqual(['10.0.0.1']);
  });
});
