import { ApiError } from '@rrhh/api-client';
import { describe, expect, it } from 'vitest';

import { attendanceErrorMessage } from './attendance-error-message';

describe('attendanceErrorMessage', () => {
  it.each([
    [
      'ACCOUNT_NOT_LINKED',
      403,
      'Tu cuenta no está vinculada a un colaborador, así que no hay asistencia que mostrar.',
    ],
    ['EMPLOYEE_WITHOUT_SITE', 409, 'Aún no tienes sede asignada. Pide a RRHH que la registre.'],
    ['MONTH_NOT_AVAILABLE', 422, 'Solo puedes consultar el mes actual y el anterior.'],
  ])('traduce %s', (code, status, expected) => {
    expect(attendanceErrorMessage(new ApiError(status, code, 'texto del servidor'))).toBe(expected);
  });

  it('otro ApiError menciona su código', () => {
    expect(attendanceErrorMessage(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toBe(
      'No se pudo cargar tu asistencia (INTERNAL_ERROR).',
    );
  });

  it('un error que no es ApiError se trata como falla de conexión', () => {
    const expected = 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.';
    expect(attendanceErrorMessage(new TypeError('Network request failed'))).toBe(expected);
    expect(attendanceErrorMessage('boom')).toBe(expected);
    expect(attendanceErrorMessage(undefined)).toBe(expected);
  });
});
