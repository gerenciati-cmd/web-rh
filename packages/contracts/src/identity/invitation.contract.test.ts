import { PERMISSIONS } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { apiRoutes } from '../index';

import { SessionUserSchema } from './auth.contract';
import {
  ActivateAccountSchema,
  InvitationSchema,
  InviteEmployeeSchema,
  InviteExternalSchema,
  invitationRoutes,
} from './invitation.contract';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('invitationRoutes: método, path, status y acceso', () => {
  it('inviteEmployee exige identity.users:invite sobre la empresa de la ruta y responde 201', () => {
    expect(invitationRoutes.inviteEmployee).toMatchObject({
      method: 'POST',
      path: '/companies/:companyId/employees/:employeeId/invitations',
      successStatus: 201,
      access: {
        kind: 'permission',
        permission: 'identity.users:invite',
        companyParam: 'companyId',
      },
    });
  });

  it('inviteExternal exige identity.users:invite-external, sin alcance por empresa, y responde 201', () => {
    expect(invitationRoutes.inviteExternal).toMatchObject({
      method: 'POST',
      path: '/invitations',
      successStatus: 201,
      access: { kind: 'permission', permission: 'identity.users:invite-external' },
    });
    expect(invitationRoutes.inviteExternal.access).not.toHaveProperty('companyParam');
  });

  it('activateAccount es pública y responde 204', () => {
    expect(invitationRoutes.activateAccount).toMatchObject({
      method: 'POST',
      path: '/auth/activate',
      successStatus: 204,
      access: { kind: 'public' },
    });
  });

  it('los permisos nuevos pertenecen al vocabulario compartido', () => {
    expect(PERMISSIONS).toContain('identity.users:invite');
    expect(PERMISSIONS).toContain('identity.users:invite-external');
  });

  it('están registradas en apiRoutes.invitations', () => {
    expect(apiRoutes.invitations).toBe(invitationRoutes);
  });
});

describe('InviteEmployeeSchema', () => {
  it('el correo es opcional (se usa el de la ficha)', () => {
    expect(InviteEmployeeSchema.safeParse({}).success).toBe(true);
  });

  it('acepta un correo válido y rechaza uno inválido o de más de 254 caracteres', () => {
    expect(InviteEmployeeSchema.safeParse({ email: 'ana@aps.cl' }).success).toBe(true);
    expect(InviteEmployeeSchema.safeParse({ email: 'no-es-correo' }).success).toBe(false);
    expect(InviteEmployeeSchema.safeParse({ email: `${'a'.repeat(250)}@aps.cl` }).success).toBe(
      false,
    );
  });
});

describe('InviteExternalSchema', () => {
  it('el correo es obligatorio y válido', () => {
    expect(InviteExternalSchema.safeParse({ email: 'contador@externo.com' }).success).toBe(true);
    expect(InviteExternalSchema.safeParse({}).success).toBe(false);
    expect(InviteExternalSchema.safeParse({ email: 'x' }).success).toBe(false);
  });
});

describe('ActivateAccountSchema', () => {
  it('acepta token y contraseña', () => {
    expect(ActivateAccountSchema.safeParse({ token: 'abc', password: 'x' }).success).toBe(true);
  });

  it('no aplica la política de fortaleza: eso es WEAK_PASSWORD del caso de uso (422, no 400)', () => {
    expect(ActivateAccountSchema.safeParse({ token: 'abc', password: 'corta' }).success).toBe(true);
  });

  it.each([
    ['sin token', { password: 'x' }],
    ['token vacío', { token: '', password: 'x' }],
    ['token de más de 200 caracteres', { token: 'a'.repeat(201), password: 'x' }],
    ['sin contraseña', { token: 'abc' }],
    ['contraseña vacía', { token: 'abc', password: '' }],
    ['contraseña de más de 128 caracteres', { token: 'abc', password: 'p'.repeat(129) }],
  ])('rechaza %s', (_case, body) => {
    expect(ActivateAccountSchema.safeParse(body).success).toBe(false);
  });
});

describe('InvitationSchema (respuesta)', () => {
  it('acepta id uuid, correo y expiresAt ISO', () => {
    expect(
      InvitationSchema.safeParse({
        id: UUID,
        email: 'ana@aps.cl',
        expiresAt: '2026-01-22T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rechaza id que no es uuid o expiresAt que no es ISO', () => {
    const base = { id: UUID, email: 'ana@aps.cl', expiresAt: '2026-01-22T12:00:00.000Z' };
    expect(InvitationSchema.safeParse({ ...base, id: 'x' }).success).toBe(false);
    expect(InvitationSchema.safeParse({ ...base, expiresAt: 'mañana' }).success).toBe(false);
  });

  it('no declara campos de token (el token solo viaja por correo)', () => {
    expect(Object.keys(InvitationSchema.shape).sort()).toEqual(['email', 'expiresAt', 'id']);
  });
});

describe('SessionUserSchema.employeeId', () => {
  const base = { id: UUID, email: 'ana@aps.cl' };

  it('acepta null (cuenta sin colaborador) y un uuid', () => {
    expect(SessionUserSchema.safeParse({ ...base, employeeId: null }).success).toBe(true);
    expect(SessionUserSchema.safeParse({ ...base, employeeId: UUID }).success).toBe(true);
  });

  it('es obligatorio y debe ser uuid', () => {
    expect(SessionUserSchema.safeParse(base).success).toBe(false);
    expect(SessionUserSchema.safeParse({ ...base, employeeId: 'x' }).success).toBe(false);
  });
});
