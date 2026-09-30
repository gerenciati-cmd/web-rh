import { z } from 'zod';

import { defineRoute, publicAccess, requires } from '../http';

export const PasswordResetSchema = z
  .object({ id: z.uuid(), email: z.email(), expiresAt: z.iso.datetime() })
  .meta({ id: 'PasswordReset' });
export type PasswordResetDto = z.infer<typeof PasswordResetSchema>;

export const RequestPasswordResetSchema = z
  .object({ email: z.email().max(254) })
  .meta({ id: 'RequestPasswordResetInput' });
export type RequestPasswordResetInput = z.input<typeof RequestPasswordResetSchema>;

// Sin regla de fortaleza aquí: la política la aplica el caso de uso (WEAK_PASSWORD, 422).
export const ResetPasswordSchema = z
  .object({ token: z.string().min(1).max(200), password: z.string().min(1).max(128) })
  .meta({ id: 'ResetPasswordInput' });
export type ResetPasswordInput = z.input<typeof ResetPasswordSchema>;

export const passwordResetRoutes = {
  requestPasswordReset: defineRoute({
    method: 'POST',
    path: '/auth/password-reset',
    summary:
      'Envía un enlace para restablecer la contraseña (responde igual exista o no el correo)',
    access: publicAccess,
    body: RequestPasswordResetSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
  resetPassword: defineRoute({
    method: 'POST',
    path: '/auth/password-reset/confirm',
    summary: 'Fija la contraseña nueva con el token del enlace y cierra todas las sesiones',
    access: publicAccess,
    body: ResetPasswordSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
  forceEmployeePasswordReset: defineRoute({
    method: 'POST',
    path: '/companies/:companyId/employees/:employeeId/password-reset',
    summary: 'Fuerza el restablecimiento de contraseña de un colaborador',
    access: requires('identity.users:reset-password', { companyParam: 'companyId' }),
    params: z.object({ companyId: z.uuid(), employeeId: z.uuid() }),
    response: PasswordResetSchema,
    successStatus: 201,
  }),
  forceUserPasswordReset: defineRoute({
    method: 'POST',
    path: '/users/:userId/password-reset',
    summary: 'Fuerza el restablecimiento de contraseña de cualquier usuario',
    access: requires('identity.users:reset-password-any'),
    params: z.object({ userId: z.uuid() }),
    response: PasswordResetSchema,
    successStatus: 201,
  }),
};
