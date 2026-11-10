import { ApiError } from '@rrhh/api-client';

/** Traduce un error de login a un mensaje para la persona usuaria. */
export function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.';
  }

  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'Correo o contraseña incorrectos.';
    case 'LOGIN_TEMPORARILY_BLOCKED': {
      const seconds = (error.details as { retryAfterSeconds?: unknown } | undefined)
        ?.retryAfterSeconds;
      if (typeof seconds === 'number' && Number.isFinite(seconds)) {
        const minutes = Math.max(1, Math.ceil(seconds / 60));
        return `Demasiados intentos. Intenta de nuevo en ${minutes} min.`;
      }
      return 'Demasiados intentos. Intenta de nuevo en unos minutos.';
    }
    case 'VALIDATION_ERROR':
      return 'Escribe un correo y una contraseña válidos.';
    default:
      return `No se pudo iniciar sesión (${error.code}).`;
  }
}
