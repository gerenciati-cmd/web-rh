import { z } from 'zod';

import { defineRoute, publicAccess, requires } from '../http';

export const InvitationSchema = z
  .object({
    id: z.uuid(),
    email: z.email().describe('Correo al que se envió la invitación'),
    expiresAt: z.iso.datetime().describe('Instante en que expira el enlace de activación'),
  })
  .meta({ id: 'Invitation' });
export type InvitationDto = z.infer<typeof InvitationSchema>;

export const InviteEmployeeSchema = z
  .object({
    email: z
      .email()
      .max(254)
      .optional()
      .describe('Opcional. Correo de la cuenta; si se omite se usa el correo del colaborador'),
  })
  .meta({ id: 'InviteEmployeeInput' });
export type InviteEmployeeInput = z.input<typeof InviteEmployeeSchema>;

export const InviteExternalSchema = z
  .object({ email: z.email().max(254).describe('Correo de la persona invitada') })
  .meta({ id: 'InviteExternalInput' });
export type InviteExternalInput = z.input<typeof InviteExternalSchema>;

// Sin regla de fortaleza aquí: la política la aplica el caso de uso (WEAK_PASSWORD, 422).
export const ActivateAccountSchema = z
  .object({
    token: z.string().min(1).max(200).describe('Token del enlace recibido por correo'),
    password: z
      .string()
      .min(1)
      .max(128)
      .describe('Contraseña nueva; la política exige entre 12 y 128 caracteres'),
  })
  .meta({ id: 'ActivateAccountInput' });
export type ActivateAccountInput = z.input<typeof ActivateAccountSchema>;

const EmployeeInvitationParams = z.object({
  companyId: z.uuid().describe('Id de la empresa del colaborador'),
  employeeId: z.uuid().describe('Id del colaborador'),
});

export const invitationRoutes = {
  inviteEmployee: defineRoute({
    method: 'POST',
    path: '/companies/:companyId/employees/:employeeId/invitations',
    summary: 'Invita a un colaborador a activar su acceso',
    description: [
      'Envía por correo un enlace para que un colaborador cree su cuenta y su contraseña. Si ya había una invitación pendiente para ese correo, la reemplaza.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** que el colaborador esté activo y sin cuenta. Opcionalmente un correo distinto al registrado.',
    ].join('\n'),
    errors: [
      'EMPLOYEE_NOT_FOUND',
      'EMPLOYEE_ALREADY_HAS_ACCESS',
      'EMAIL_ALREADY_REGISTERED',
      'EMPLOYEE_INACTIVE',
    ],
    access: requires('identity.users:invite', { companyParam: 'companyId' }),
    params: EmployeeInvitationParams,
    body: InviteEmployeeSchema,
    response: InvitationSchema,
    successStatus: 201,
  }),
  inviteExternal: defineRoute({
    method: 'POST',
    path: '/invitations',
    summary: 'Invita a una persona que no es colaborador',
    description: [
      'Envía por correo un enlace de activación a alguien que no está en el directorio de colaboradores (por ejemplo, un administrador externo).',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** el correo de la persona, que no debe tener cuenta.',
    ].join('\n'),
    errors: ['EMAIL_ALREADY_REGISTERED'],
    access: requires('identity.users:invite-external'),
    body: InviteExternalSchema,
    response: InvitationSchema,
    successStatus: 201,
  }),
  activateAccount: defineRoute({
    method: 'POST',
    path: '/auth/activate',
    summary: 'Activa la cuenta con el token de la invitación y fija la contraseña',
    description: [
      'Termina el alta de una cuenta invitada: valida el token del correo y fija la contraseña.',
      '',
      '**Quién puede:** cualquiera con un token válido (ruta pública).',
      '',
      '**Efectos:** crea el usuario y consume la invitación; el token no se puede reutilizar. No inicia sesión: después hay que llamar a `POST /auth/login`.',
    ].join('\n'),
    errors: [
      'INVITATION_NOT_VALID',
      'EMAIL_ALREADY_REGISTERED',
      'EMPLOYEE_ALREADY_HAS_ACCESS',
      'WEAK_PASSWORD',
    ],
    access: publicAccess,
    body: ActivateAccountSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
};
