import type { LoginThrottle } from './login-throttle';

export interface LoginThrottleRepository {
  /**
   * Debe llamarse dentro de `transactionRunner.run` (H3): crea la fila si no existe y la
   * bloquea (row lock) hasta el fin de la transacción, para que los intentos concurrentes de
   * login se serialicen en vez de perderse (lost update) al leer el mismo contador.
   */
  lock(key: string, now: Date): Promise<LoginThrottle>;
  save(throttle: LoginThrottle): Promise<void>;
}
