import { err, ok, type Result } from '@rrhh/domain';

import { WeakPasswordError } from './errors';

// NIST SP 800-63B: privilegia el largo sobre reglas de composición (mayúsculas/símbolos/etc).
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Cuenta puntos de código Unicode, no unidades UTF-16 (un emoji no cuenta doble). */
export function checkPasswordPolicy(plain: string): Result<void, WeakPasswordError> {
  // El spread sobre un string SÍ es lo correcto aquí: itera por punto de código Unicode,
  // que es justo lo que se quiere contar (a diferencia de `.length`, que cuenta unidades UTF-16).
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  const length = [...plain].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return err(new WeakPasswordError(PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH));
  }
  return ok(undefined);
}
