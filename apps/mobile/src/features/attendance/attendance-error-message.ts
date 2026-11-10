import { ApiError } from '@rrhh/api-client';

/** Traduce un error de lectura de asistencia a un mensaje para la persona usuaria. */
export function attendanceErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.';
  }

  switch (error.code) {
    case 'ACCOUNT_NOT_LINKED':
      return 'Tu cuenta no está vinculada a un colaborador, así que no hay asistencia que mostrar.';
    case 'EMPLOYEE_WITHOUT_SITE':
      return 'Aún no tienes sede asignada. Pide a RRHH que la registre.';
    case 'MONTH_NOT_AVAILABLE':
      return 'Solo puedes consultar el mes actual y el anterior.';
    default:
      return `No se pudo cargar tu asistencia (${error.code}).`;
  }
}
