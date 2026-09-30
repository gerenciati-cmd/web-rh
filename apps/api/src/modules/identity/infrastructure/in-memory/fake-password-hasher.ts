import type { PasswordHasher } from '../../application/ports/password-hasher';

/** Doble determinista: sin costo real, para que los tests de aplicación no dependan de argon2. */
export class FakePasswordHasher implements PasswordHasher {
  /** Cuántas veces se llamó `simulateVerify`: permite comprobar que la rama de tiempo constante corrió. */
  simulateVerifyCalls = 0;

  hash(plain: string): Promise<string> {
    return Promise.resolve(`fake:${plain}`);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return Promise.resolve(hash === `fake:${plain}`);
  }

  simulateVerify(_plain: string): Promise<void> {
    this.simulateVerifyCalls += 1;
    return Promise.resolve();
  }
}
