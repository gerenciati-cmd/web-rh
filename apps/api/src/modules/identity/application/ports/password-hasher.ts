export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(plain: string, hash: string): Promise<boolean>;
  /**
   * Verifica contra un hash fijo cuando el correo no existe, para que el tiempo de
   * respuesta no delate si la cuenta existe (mismo costo que `verify`).
   */
  simulateVerify(plain: string): Promise<void>;
}
