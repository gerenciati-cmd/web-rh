import { z } from 'zod';

import { defineRoute, publicAccess, requires } from '../http';

export const InvitationSchema = z
  .object({ id: z.uuid(), email: z.email(), expiresAt: z.iso.datetime() })
  .meta({ id: 'Invitation' });
export type InvitationDto = z.infer<typeof InvitationSchema>;

export const InviteEmployeeSchema = z
  .object({ email: z.email().max(254).optional() })
  .meta({ id: 'InviteEmployeeInput' });
export type InviteEmployeeInput = z.input<typeof InviteEmployeeSchema>;

export const InviteExternalSchema = z
  .object({ email: z.email().max(254) })
  .meta({ id: 'InviteExternalInput' });
export type InviteExternalInput = z.input<typeof InviteExternalSchema>;

// Sin regla de fortaleza aquí: la política la aplica el caso de uso (WEAK_PASSWORD, 422).
export const ActivateAccountSchema = z
  .object({ token: z.string().min(1).max(200), password: z.string().min(1).max(128) })
  .meta({ id: 'ActivateAccountInput' });
export type ActivateAccountInput = z.input<typeof ActivateAccountSchema>;

const EmployeeInvitationParams = z.object({ companyId: z.uuid(), employeeId: z.uuid() });

export const invitationRoutes = {
  inviteEmployee: defineRoute({
    method: 'POST',
    path: '/companies/:companyId/employees/:employeeId/invitations',
    summary: 'Invita a un colaborador a activar su acceso',
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
    access: requires('identity.users:invite-external'),
    body: InviteExternalSchema,
    response: InvitationSchema,
    successStatus: 201,
  }),
  activateAccount: defineRoute({
    method: 'POST',
    path: '/auth/activate',
    summary: 'Activa la cuenta con el token de la invitación y fija la contraseña',
    access: publicAccess,
    body: ActivateAccountSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
};
