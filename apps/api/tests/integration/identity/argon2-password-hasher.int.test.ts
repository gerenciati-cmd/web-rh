import { argon2, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { Argon2PasswordHasher } from '@/modules/identity/infrastructure/argon2-password-hasher';

const argon2Async = promisify(argon2);

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('hash produce un string PHC con los parámetros OWASP ($argon2id$v=19$m=19456,t=2,p=1$...)', async () => {
    const hash = await hasher.hash('contraseña-de-prueba-larga');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[^$]+\$[^$]+$/);
  });

  it('verify acepta la contraseña correcta y rechaza una incorrecta', async () => {
    const hash = await hasher.hash('correcta-y-larga');

    expect(await hasher.verify('correcta-y-larga', hash)).toBe(true);
    expect(await hasher.verify('incorrecta-y-larga', hash)).toBe(false);
  });

  it('dos hashes de la misma contraseña son distintos (salt aleatorio)', async () => {
    const a = await hasher.hash('misma-contraseña');
    const b = await hasher.hash('misma-contraseña');

    expect(a).not.toBe(b);
  });

  it('verify devuelve false para un hash malformado, sin lanzar', async () => {
    await expect(hasher.verify('cualquier-cosa', 'no-es-un-hash-phc')).resolves.toBe(false);
    await expect(hasher.verify('cualquier-cosa', '$argon2id$v=19$m=x$salt$hash')).resolves.toBe(
      false,
    );
  });

  it('verify usa los parámetros GUARDADOS en el hash, no las constantes actuales (compatibilidad hacia atrás)', async () => {
    // Construye a mano un hash "viejo" con memoria/passes distintos a las constantes actuales
    // del adaptador (m=19456,t=2), replicando el mismo formato PHC que produce `hash()`.
    const salt = randomBytes(16);
    const plain = 'contraseña-con-parametros-viejos';
    const derived = await argon2Async('argon2id', {
      message: plain,
      nonce: salt,
      parallelism: 1,
      tagLength: 32,
      memory: 9_216,
      passes: 3,
    });
    const oldHash = `$argon2id$v=19$m=9216,t=3,p=1$${salt.toString('base64url')}$${derived.toString('base64url')}`;

    expect(await hasher.verify(plain, oldHash)).toBe(true);
    expect(await hasher.verify('otra-cosa-larga', oldHash)).toBe(false);
  });

  it('simulateVerify no lanza y resuelve sin exponer nada', async () => {
    await expect(hasher.simulateVerify('cualquier-cosa')).resolves.toBeUndefined();
  });
});
