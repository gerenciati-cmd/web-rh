import { z } from 'zod';

import { defineRoute, publicAccess, requires } from '../http';

export const PasswordResetSchema = z
  .object({
    id: z.uuid(),
    email: z.email().describe('Correo al que se envió el enlace'),
    expiresAt: z.iso.datetime().describe('Instante en que expira el enlace'),
  })
  .meta({ id: 'PasswordReset' });
export type PasswordResetDto = z.infer<typeof PasswordResetSchema>;

export const RequestPasswordResetSchema = z
  .object({ email: z.email().max(254).describe('Correo de la cuenta') })
  .meta({ id: 'RequestPasswordResetInput' });
export type RequestPasswordResetInput = z.input<typeof RequestPasswordResetSchema>;

// Sin regla de fortaleza aquí: la política la aplica el caso de uso (WEAK_PASSWORD, 422).
export const ResetPasswordSchema = z
  .object({
    token: z.string().min(1).max(200).describe('Token del enlace recibido por correo'),
    password: z
      .string()
      .min(1)
      .max(128)
      .describe('Contraseña nueva; la política exige entre 12 y 128 caracteres'),
  })
  .meta({ id: 'ResetPasswordInput' });
export type ResetPasswordInput = z.input<typeof ResetPasswordSchema>;

export const passwordResetRoutes = {
  requestPasswordReset: defineRoute({
    method: 'POST',
    path: '/auth/password-reset',
    summary:
      'Envía un enlace para restablecer la contraseña (responde igual exista o no el correo)',
    description: [
      'Pide un enlace de restablecimiento de contraseña. Siempre responde 204, exista o no la cuenta, para no revelar qué correos están registrados.',
      '',
      '**Quién puede:** cualquiera (ruta pública).',
      '',
      '**Efectos:** si la cuenta existe y está activa, envía el correo con el enlace.',
    ].join('\n'),
    access: publicAccess,
    body: RequestPasswordResetSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
  resetPassword: defineRoute({
    method: 'POST',
    path: '/auth/password-reset/confirm',
    summary: 'Fija la contraseña nueva con el token del enlace y cierra todas las sesiones',
    description: [
      'Fija una contraseña nueva usando el token del enlace de restablecimiento.',
      '',
      '**Quién puede:** cualquiera con un token válido (ruta pública).',
      '',
      '**Efectos:** consume el token, cierra todas las sesiones abiertas del usuario y limpia su bloqueo de inicio de sesión.',
    ].join('\n'),
    errors: ['PASSWORD_RESET_NOT_VALID', 'WEAK_PASSWORD'],
    access: publicAccess,
    body: ResetPasswordSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
  forceEmployeePasswordReset: defineRoute({
    method: 'POST',
    path: '/companies/:companyId/employees/:employeeId/password-reset',
    summary: 'Fuerza el restablecimiento de contraseña de un colaborador',
    description: [
      'Genera y envía un enlace de restablecimiento al correo de la cuenta de un colaborador.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** que el colaborador tenga cuenta activa. Responde con los datos del enlace generado.',
    ].join('\n'),
    errors: ['EMPLOYEE_NOT_FOUND', 'USER_NOT_FOUND', 'USER_DISABLED'],
    access: requires('identity.users:reset-password', { companyParam: 'companyId' }),
    params: z.object({
      companyId: z.uuid().describe('Id de la empresa del colaborador'),
      employeeId: z.uuid().describe('Id del colaborador'),
    }),
    response: PasswordResetSchema,
    successStatus: 201,
  }),
  forceUserPasswordReset: defineRoute({
    method: 'POST',
    path: '/users/:userId/password-reset',
    summary: 'Fuerza el restablecimiento de contraseña de cualquier usuario',
    description: [
      'Genera y envía un enlace de restablecimiento al correo de cualquier usuario, sea o no colaborador.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** que el usuario esté activo. Responde con los datos del enlace generado.',
    ].join('\n'),
    errors: ['USER_NOT_FOUND', 'USER_DISABLED'],
    access: requires('identity.users:reset-password-any'),
    params: z.object({ userId: z.uuid().describe('Id del usuario') }),
    response: PasswordResetSchema,
    successStatus: 201,
  }),
};
