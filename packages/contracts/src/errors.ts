import type { ApiErrorBody } from './common';

/** Estados HTTP con los que la API responde un error de la forma `ApiError`. */
export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500;

/** Documentación de un código de error: cuándo ocurre y cómo se ve el cuerpo. */
export interface ApiErrorDoc {
  readonly status: ApiErrorStatus;
  /** Cuándo ocurre, en una oración. */
  readonly description: string;
  /**
   * Cuerpos de ejemplo: el `message` real de la clase de error y valores sintéticos en `details`.
   * `default` es el habitual; hay una variante cuando varias clases comparten el código pero
   * responden un cuerpo distinto según el módulo (la ruta elige con `{ code, variant }`).
   */
  readonly examples: { readonly default: ApiErrorBody; readonly [variant: string]: ApiErrorBody };
}

/** Referencia a un error en una ruta: el código solo (variante `default`) o con una variante declarada. */
export type ApiErrorRef =
  | ApiErrorCode
  | {
      [C in ApiErrorCode]: {
        readonly code: C;
        readonly variant: Exclude<keyof (typeof API_ERRORS)[C]['examples'], 'default'>;
      };
    }[ApiErrorCode];

/** Código de un `ApiErrorRef`. */
export function errorRefCode(ref: ApiErrorRef): ApiErrorCode {
  return typeof ref === 'string' ? ref : ref.code;
}

/** Variante de un `ApiErrorRef` (`default` si es solo el código). */
export function errorRefVariant(ref: ApiErrorRef): string {
  return typeof ref === 'string' ? 'default' : ref.variant;
}

const COMPANY_ID = '0191a2b3-0000-7000-8000-00000000c001';
const SITE_ID = '0191a2b3-0000-7000-8000-00000000d001';
const DEVICE_ID = '0191a2b3-0000-7000-8000-00000000e001';
const EMPLOYEE_ID = '0191a2b3-0000-7000-8000-00000000f001';

/**
 * Catálogo único de errores de la API: código → status, descripción y ejemplo. Alimenta la
 * referencia OpenAPI (`components.examples`) y un test del API lo mantiene igual a los códigos que
 * el código puede devolver. Los códigos compartidos por varias clases (mismo significado) van una vez.
 */
export const API_ERRORS = {
  // ── Genéricos (capa HTTP) ────────────────────────────────────────────────
  VALIDATION_ERROR: {
    status: 400,
    description:
      'La solicitud no cumple el contrato: `details.location` dice dónde (params, query o body) y `details.issues` qué campos fallan.',
    examples: {
      default: {
        code: 'VALIDATION_ERROR',
        message: 'Solicitud inválida en body',
        details: {
          location: 'body',
          issues: [
            {
              origin: 'string',
              code: 'invalid_format',
              format: 'uuid',
              pattern:
                '/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/',
              path: ['siteId'],
              message: 'Invalid UUID',
            },
          ],
        },
      },
    },
  },
  MALFORMED_JSON: {
    status: 400,
    description: 'El cuerpo de la petición no es JSON válido.',
    examples: {
      default: {
        code: 'MALFORMED_JSON',
        message: 'El cuerpo de la petición no es JSON válido',
      },
    },
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    description:
      'El cuerpo de la petición supera el límite: 1 MB en `/api/v1` (5 MB en las rutas `/iclock` de los checadores).',
    examples: {
      default: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'El cuerpo de la petición supera el tamaño permitido',
      },
    },
  },
  AUTHENTICATION_REQUIRED: {
    status: 401,
    description: 'La ruta exige sesión y la solicitud no trae una sesión válida o ya expiró.',
    examples: { default: { code: 'AUTHENTICATION_REQUIRED', message: 'Debes iniciar sesión' } },
  },
  FORBIDDEN: {
    status: 403,
    description:
      'La sesión es válida, pero no tiene el permiso que exige la ruta (o no para esa empresa).',
    examples: { default: { code: 'FORBIDDEN', message: 'No tienes permiso para esta acción' } },
  },
  ROUTE_NOT_FOUND: {
    status: 404,
    description: 'No existe una ruta con ese método y path.',
    examples: { default: { code: 'ROUTE_NOT_FOUND', message: 'No existe GET /api/v1/nada' } },
  },
  INTERNAL_ERROR: {
    status: 500,
    description: 'Error inesperado del servidor; el detalle solo queda en los logs.',
    examples: { default: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' } },
  },
  INVALID_VALUE: {
    status: 422,
    description:
      'Un valor no cumple una regla del dominio. Hoy las rutas repiten esas reglas en el contrato, así que normalmente responde antes `VALIDATION_ERROR` (400); queda como red de seguridad y ninguna ruta lo declara. El `message` cambia según la regla.',
    examples: {
      default: { code: 'INVALID_VALUE', message: 'Nombre y apellido son obligatorios' },
    },
  },
  BUSINESS_RULE_VIOLATION: {
    status: 422,
    description:
      'Se infringe una regla de negocio sin código propio; el `message` dice cuál. Hoy: registrar una contratación con demasiada anticipación.',
    examples: {
      default: {
        code: 'BUSINESS_RULE_VIOLATION',
        message: 'No se puede registrar una contratación con más de 90 días de anticipación',
      },
    },
  },

  // ── organization ─────────────────────────────────────────────────────────
  COMPANY_NOT_FOUND: {
    status: 404,
    description: 'La empresa indicada no existe.',
    examples: {
      default: {
        code: 'COMPANY_NOT_FOUND',
        message: 'La empresa no existe',
        details: { companyId: COMPANY_ID },
      },
    },
  },
  COMPANY_ALREADY_EXISTS: {
    status: 409,
    description: 'Ya hay una empresa con ese identificador tributario.',
    examples: {
      default: {
        code: 'COMPANY_ALREADY_EXISTS',
        message: 'Ya existe una empresa con ese identificador tributario',
        details: { taxId: 'AAA010101AAA' },
      },
    },
  },
  COMPANY_INACTIVE: {
    status: 422,
    description: 'La empresa está inactiva y no admite la operación.',
    examples: {
      default: {
        code: 'COMPANY_INACTIVE',
        message: 'No se puede contratar en una empresa inactiva',
        details: { companyId: COMPANY_ID },
      },
      role_assignment: {
        code: 'COMPANY_INACTIVE',
        message: 'No se puede asignar un rol en una empresa inactiva',
        details: { companyId: COMPANY_ID },
      },
    },
  },
  SITE_ALREADY_EXISTS: {
    status: 409,
    description: 'Ya hay una sede con ese nombre.',
    examples: {
      default: {
        code: 'SITE_ALREADY_EXISTS',
        message: 'Ya existe una sede con ese nombre',
        details: { name: 'Sede Cancún Centro' },
      },
    },
  },

  // ── employees / sedes ────────────────────────────────────────────────────
  EMPLOYEE_ALREADY_EXISTS: {
    status: 409,
    description: 'El colaborador ya está registrado en esa empresa (mismo documento de identidad).',
    examples: {
      default: {
        code: 'EMPLOYEE_ALREADY_EXISTS',
        message: 'El colaborador ya está registrado en esta empresa',
        details: { nationalId: 'GOMA850101HQRRRN04' },
      },
    },
  },
  EMPLOYEE_NOT_FOUND: {
    status: 404,
    description:
      'El colaborador no existe (también cuando pertenece a otra empresa: responde igual).',
    examples: {
      default: {
        code: 'EMPLOYEE_NOT_FOUND',
        message: 'El colaborador no existe',
        details: { employeeId: EMPLOYEE_ID },
      },
      identity: { code: 'EMPLOYEE_NOT_FOUND', message: 'El colaborador no existe' },
    },
  },
  EMPLOYEE_RFC_ALREADY_REGISTERED: {
    status: 409,
    description: 'Otro colaborador ya tiene ese RFC.',
    examples: {
      default: {
        code: 'EMPLOYEE_RFC_ALREADY_REGISTERED',
        message: 'Ya hay un colaborador registrado con ese RFC',
        details: { rfc: 'GOMA850101AB1' },
      },
    },
  },
  RFC_NOT_APPLICABLE: {
    status: 422,
    description: 'El RFC solo aplica a colaboradores de México.',
    examples: {
      default: {
        code: 'RFC_NOT_APPLICABLE',
        message: 'El RFC solo aplica a colaboradores de México',
      },
    },
  },
  SITE_NOT_FOUND: {
    status: 404,
    description: 'La sede indicada no existe.',
    examples: {
      default: {
        code: 'SITE_NOT_FOUND',
        message: 'La sede no existe',
        details: { siteId: SITE_ID },
      },
    },
  },
  SITE_INACTIVE: {
    status: 422,
    description: 'La sede está inactiva y no se le puede asignar nada.',
    examples: {
      default: {
        code: 'SITE_INACTIVE',
        message: 'La sede está inactiva',
        details: { siteId: SITE_ID },
      },
    },
  },
  SITE_COUNTRY_MISMATCH: {
    status: 422,
    description: 'La sede es de un país distinto al de la razón social.',
    examples: {
      default: {
        code: 'SITE_COUNTRY_MISMATCH',
        message: 'La sede no es del mismo país que la razón social',
        details: { siteId: SITE_ID, siteCountry: 'MX', companyCountry: 'CO' },
      },
    },
  },

  // ── attendance ───────────────────────────────────────────────────────────
  DEVICE_NOT_FOUND: {
    status: 404,
    description: 'El checador indicado no existe.',
    examples: {
      default: {
        code: 'DEVICE_NOT_FOUND',
        message: 'El checador no existe',
        details: { deviceId: DEVICE_ID },
      },
    },
  },
  DEVICE_ALREADY_REGISTERED: {
    status: 409,
    description: 'Ya hay un equipo con ese número de serie.',
    examples: {
      default: {
        code: 'DEVICE_ALREADY_REGISTERED',
        message: 'Ya existe un equipo con ese número de serie',
        details: { serialNumber: 'CKVE000001' },
      },
    },
  },
  DEVICE_NOT_ALLOWED: {
    status: 422,
    description: 'El equipo no está autorizado (no registrado) para enviar datos.',
    examples: {
      default: {
        code: 'DEVICE_NOT_ALLOWED',
        message: 'El dispositivo no está autorizado',
        details: { serialNumber: 'CKVE000001' },
      },
    },
  },
  DEVICE_NETWORK_UNRESTRICTED: {
    status: 422,
    description: 'El checador no tiene redes permitidas: no puede recibir comandos.',
    examples: {
      default: {
        code: 'DEVICE_NETWORK_UNRESTRICTED',
        message: 'El checador no tiene redes permitidas: no puede recibir comandos',
        details: { deviceId: DEVICE_ID },
      },
    },
  },
  DEVICE_WITHOUT_SITE: {
    status: 422,
    description: 'El checador no tiene sede asignada: no hay colaboradores que sincronizar.',
    examples: {
      default: {
        code: 'DEVICE_WITHOUT_SITE',
        message: 'El checador no tiene sede asignada',
        details: { deviceId: DEVICE_ID },
      },
    },
  },

  // ── identity: sesión y contraseñas ───────────────────────────────────────
  INVALID_CREDENTIALS: {
    status: 401,
    description:
      'Correo o contraseña incorrectos; es el mismo error si el correo no existe (no revela cuentas).',
    examples: {
      default: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos' },
    },
  },
  LOGIN_TEMPORARILY_BLOCKED: {
    status: 429,
    description:
      'Demasiados intentos fallidos; `details.retryAfterSeconds` (y el encabezado `Retry-After`) dicen cuánto esperar.',
    examples: {
      default: {
        code: 'LOGIN_TEMPORARILY_BLOCKED',
        message: 'Demasiados intentos fallidos. Intenta de nuevo más tarde',
        details: { retryAfterSeconds: 300 },
      },
    },
  },
  WEAK_PASSWORD: {
    status: 422,
    description: 'La contraseña no cumple la política de longitud.',
    examples: {
      default: {
        code: 'WEAK_PASSWORD',
        message: 'La contraseña debe tener entre 12 y 128 caracteres',
      },
    },
  },
  PASSWORD_RESET_NOT_VALID: {
    status: 422,
    description:
      'El enlace de restablecimiento no es válido: desconocido, expirado, usado, reemplazado o de un usuario deshabilitado (mismo cuerpo en todos los casos).',
    examples: {
      default: {
        code: 'PASSWORD_RESET_NOT_VALID',
        message: 'El enlace para restablecer la contraseña no es válido o ya expiró',
      },
    },
  },

  // ── identity: usuarios e invitaciones ────────────────────────────────────
  USER_ALREADY_EXISTS: {
    status: 409,
    description: 'Ya existe un usuario con ese correo.',
    examples: {
      default: { code: 'USER_ALREADY_EXISTS', message: 'Ya existe un usuario con ese correo' },
    },
  },
  USER_NOT_FOUND: {
    status: 404,
    description: 'El usuario indicado no existe.',
    examples: { default: { code: 'USER_NOT_FOUND', message: 'El usuario no existe' } },
  },
  USER_DISABLED: {
    status: 422,
    description: 'El usuario está deshabilitado y no admite la operación.',
    examples: { default: { code: 'USER_DISABLED', message: 'El usuario está deshabilitado' } },
  },
  EMAIL_ALREADY_REGISTERED: {
    status: 409,
    description: 'Ya existe un usuario con ese correo.',
    examples: {
      default: { code: 'EMAIL_ALREADY_REGISTERED', message: 'Ya existe un usuario con ese correo' },
    },
  },
  EMPLOYEE_INACTIVE: {
    status: 422,
    description: 'El colaborador está desvinculado y no se le puede invitar.',
    examples: {
      default: {
        code: 'EMPLOYEE_INACTIVE',
        message: 'No se puede invitar a un colaborador desvinculado',
      },
    },
  },
  EMPLOYEE_ALREADY_HAS_ACCESS: {
    status: 409,
    description: 'El colaborador ya tiene una cuenta vinculada.',
    examples: {
      default: { code: 'EMPLOYEE_ALREADY_HAS_ACCESS', message: 'El colaborador ya tiene acceso' },
    },
  },
  INVITATION_NOT_VALID: {
    status: 422,
    description:
      'La invitación no es válida: token desconocido, expirado, usado o reemplazado (mismo cuerpo en todos los casos).',
    examples: {
      default: {
        code: 'INVITATION_NOT_VALID',
        message: 'La invitación no es válida o ya expiró',
      },
    },
  },

  // ── identity: roles ──────────────────────────────────────────────────────
  ROLE_NOT_ASSIGNABLE: {
    status: 422,
    description: 'Ese rol existe pero todavía no se puede asignar por la API.',
    examples: {
      default: { code: 'ROLE_NOT_ASSIGNABLE', message: 'Ese rol todavía no se puede asignar' },
    },
  },
  INVALID_ROLE_SCOPE: {
    status: 422,
    description:
      'El alcance no corresponde al rol: HOLDING_ADMIN no lleva empresa; HR requiere una.',
    examples: {
      default: {
        code: 'INVALID_ROLE_SCOPE',
        message: 'HOLDING_ADMIN no lleva empresa; HR requiere una empresa',
      },
    },
  },
  ROLE_ALREADY_ASSIGNED: {
    status: 409,
    description: 'El usuario ya tiene ese rol activo (en esa empresa).',
    examples: {
      default: { code: 'ROLE_ALREADY_ASSIGNED', message: 'El usuario ya tiene ese rol activo' },
    },
  },
  ROLE_ASSIGNMENT_NOT_FOUND: {
    status: 404,
    description: 'La asignación de rol no existe para ese usuario.',
    examples: {
      default: { code: 'ROLE_ASSIGNMENT_NOT_FOUND', message: 'La asignación de rol no existe' },
    },
  },
  LAST_HOLDING_ADMIN: {
    status: 422,
    description: 'Revocarla dejaría al holding sin ningún administrador.',
    examples: {
      default: {
        code: 'LAST_HOLDING_ADMIN',
        message: 'No se puede quitar el último administrador del holding',
      },
    },
  },
} as const satisfies Record<string, ApiErrorDoc>;

/** Código de error documentado en el catálogo. */
export type ApiErrorCode = keyof typeof API_ERRORS;
