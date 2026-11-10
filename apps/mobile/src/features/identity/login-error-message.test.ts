import { ApiError } from '@rrhh/api-client';
import { describe, expect, it } from 'vitest';

import { loginErrorMessage } from './login-error-message';

const apiError = (code: string, details?: Record<string, unknown>) =>
  new ApiError(400, code, 'msg', details);

describe('loginErrorMessage', () => {
  it('traduce INVALID_CREDENTIALS', () => {
    expect(loginErrorMessage(apiError('INVALID_CREDENTIALS'))).toBe(
      'Correo o contraseña incorrectos.',
    );
  });

  it('traduce VALIDATION_ERROR', () => {
    expect(loginErrorMessage(apiError('VALIDATION_ERROR'))).toBe(
      'Escribe un correo y una contraseña válidos.',
    );
  });

  it('redondea hacia arriba los segundos de bloqueo a minutos', () => {
    const error = apiError('LOGIN_TEMPORARILY_BLOCKED', { retryAfterSeconds: 61 });
    expect(loginErrorMessage(error)).toBe('Demasiados intentos. Intenta de nuevo en 2 min.');
  });

  it('muestra al menos 1 minuto cuando faltan pocos segundos o cero', () => {
    expect(loginErrorMessage(apiError('LOGIN_TEMPORARILY_BLOCKED', { retryAfterSeconds: 5 }))).toBe(
      'Demasiados intentos. Intenta de nuevo en 1 min.',
    );
    expect(loginErrorMessage(apiError('LOGIN_TEMPORARILY_BLOCKED', { retryAfterSeconds: 0 }))).toBe(
      'Demasiados intentos. Intenta de nuevo en 1 min.',
    );
  });

  it('usa el mensaje genérico de bloqueo sin details o con valor no numérico', () => {
    const generic = 'Demasiados intentos. Intenta de nuevo en unos minutos.';
    expect(loginErrorMessage(apiError('LOGIN_TEMPORARILY_BLOCKED'))).toBe(generic);
    expect(
      loginErrorMessage(apiError('LOGIN_TEMPORARILY_BLOCKED', { retryAfterSeconds: 'x' })),
    ).toBe(generic);
    expect(
      loginErrorMessage(apiError('LOGIN_TEMPORARILY_BLOCKED', { retryAfterSeconds: Infinity })),
    ).toBe(generic);
  });

  it('incluye el código de cualquier otro ApiError', () => {
    expect(loginErrorMessage(apiError('INTERNAL_ERROR'))).toBe(
      'No se pudo iniciar sesión (INTERNAL_ERROR).',
    );
  });

  it('trata un error que no es ApiError como falla de conexión', () => {
    expect(loginErrorMessage(new TypeError('Network request failed'))).toBe(
      'No se pudo conectar. Revisa tu conexión e intenta de nuevo.',
    );
  });
});
