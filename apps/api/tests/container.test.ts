import { afterEach, describe, expect, it } from 'vitest';

import { buildTestContainer } from './test-app';

/**
 * Red de seguridad del DI: awilix resuelve por NOMBRE en runtime, así que un typo en
 * `deps.companyRepositry` no lo detecta el compilador. Este test resuelve TODO al arrancar.
 */
describe('Composition root', () => {
  const container = buildTestContainer();

  afterEach(async () => {
    await container.dispose();
  });

  it('resuelve cada registro sin errores', () => {
    for (const name of Object.keys(container.registrations)) {
      expect(() => container.resolve(name), `no se pudo resolver "${name}"`).not.toThrow();
    }
  });
});
