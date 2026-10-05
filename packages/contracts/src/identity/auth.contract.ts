import { z } from 'zod';

import { authenticated, defineRoute, publicAccess } from '../http';

export const SessionClientSchema = z.enum(['web', 'mobile']);
export type SessionClient = z.infer<typeof SessionClientSchema>;

export const SessionUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    employeeId: z.uuid().nullable().describe('Colaborador vinculado a la cuenta; null si no tiene'),
  })
  .meta({ id: 'SessionUser' });
export type SessionUser = z.infer<typeof SessionUserSchema>;

// Sin regla de fortaleza aquí: el login debe aceptar lo que la persona escriba
// (la política solo se exige al fijar una contraseña).
export const LogInSchema = z
  .object({
    // .max(254): mismo límite que `users.email VARCHAR(254)` y `login_throttles.key VARCHAR(320)`
    // (`email:` + correo); sin él, un correo válido pero larguísimo hacía fallar el guardado del
    // throttle con un 500 en vez de un 401 (L1).
    email: z.email().max(254).describe('Correo de la cuenta'),
    password: z.string().min(1).max(128).describe('Contraseña de la cuenta'),
    client: SessionClientSchema.describe(
      'Tipo de cliente: `web` guarda la sesión en una cookie httpOnly; `mobile` devuelve un `token`',
    ),
  })
  .meta({ id: 'LogInInput' });
export type LogInInput = z.input<typeof LogInSchema>;

export const LogInResponseSchema = z
  .object({
    user: SessionUserSchema,
    expiresAt: z.iso.datetime().describe('Instante en que expira la sesión'),
    token: z
      .string()
      .nullable()
      .describe('Solo para client=mobile; en web viaja en una cookie httpOnly'),
  })
  .meta({ id: 'LogInResponse' });

export const authRoutes = {
  logIn: defineRoute({
    method: 'POST',
    path: '/auth/login',
    summary: 'Inicia sesión con correo y contraseña',
    description: [
      'Abre una sesión. Es la puerta de entrada de la API.',
      '',
      '**Quién puede:** cualquiera (ruta pública).',
      '',
      '**Necesita:** correo, contraseña y `client`. Con `client: "mobile"` la respuesta trae un `token` para usar como bearer; con `web` se fija una cookie httpOnly.',
      '',
      '**Efectos:** crea la sesión. Tras varios intentos fallidos seguidos bloquea temporalmente el acceso (429).',
    ].join('\n'),
    errors: ['INVALID_CREDENTIALS', 'LOGIN_TEMPORARILY_BLOCKED'],
    access: publicAccess,
    body: LogInSchema,
    response: LogInResponseSchema,
  }),
  logOut: defineRoute({
    method: 'POST',
    path: '/auth/logout',
    summary: 'Cierra la sesión actual',
    description: [
      'Cierra la sesión con la que se hace la llamada.',
      '',
      '**Quién puede:** cualquier usuario con sesión.',
      '',
      '**Efectos:** la sesión deja de ser válida y, en web, se borra la cookie.',
    ].join('\n'),
    access: authenticated,
    response: z.undefined(),
    successStatus: 204,
  }),
  me: defineRoute({
    method: 'GET',
    path: '/auth/me',
    summary: 'Usuario de la sesión actual',
    description: [
      'Devuelve el usuario dueño de la sesión actual.',
      '',
      '**Quién puede:** cualquier usuario con sesión. No modifica datos.',
    ].join('\n'),
    access: authenticated,
    response: SessionUserSchema,
  }),
};
