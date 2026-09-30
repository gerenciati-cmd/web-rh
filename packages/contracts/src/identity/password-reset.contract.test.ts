import { PERMISSIONS } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { apiRoutes } from '../index';

import {
  PasswordResetSchema,
  RequestPasswordResetSchema,
  ResetPasswordSchema,
  passwordResetRoutes,
} from './password-reset.contract';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('passwordResetRoutes: método, path, status y acceso', () => {
  it('requestPasswordReset es pública y responde 204', () => {
    expect(passwordResetRoutes.requestPasswordReset).toMatchObject({
      method: 'POST',
      path: '/auth/password-reset',
      successStatus: 204,
      access: { kind: 'public' },
    });
  });

  it('resetPassword es pública y responde 204', () => {
    expect(passwordResetRoutes.resetPassword).toMatchObject({
      method: 'POST',
      path: '/auth/password-reset/confirm',
      successStatus: 204,
      access: { kind: 'public' },
    });
  });

  it('forceEmployeePasswordReset exige identity.users:reset-password sobre la empresa de la ruta y responde 201', () => {
    expect(passwordResetRoutes.forceEmployeePasswordReset).toMatchObject({
      method: 'POST',
      path: '/companies/:companyId/employees/:employeeId/password-reset',
      successStatus: 201,
      access: {
        kind: 'permission',
        permission: 'identity.users:reset-password',
        companyParam: 'companyId',
      },
    });
  });

  it('forceUserPasswordReset exige identity.users:reset-password-any, sin alcance por empresa, y responde 201', () => {
    expect(passwordResetRoutes.forceUserPasswordReset).toMatchObject({
      method: 'POST',
      path: '/users/:userId/password-reset',
      successStatus: 201,
      access: { kind: 'permission', permission: 'identity.users:reset-password-any' },
    });
    expect(passwordResetRoutes.forceUserPasswordReset.access).not.toHaveProperty('companyParam');
  });

  it('los permisos nuevos pertenecen al vocabulario compartido', () => {
    expect(PERMISSIONS).toContain('identity.users:reset-password');
    expect(PERMISSIONS).toContain('identity.users:reset-password-any');
  });

  it('están registradas en apiRoutes.passwordResets', () => {
    expect(apiRoutes.passwordResets).toBe(passwordResetRoutes);
  });
});

describe('RequestPasswordResetSchema', () => {
  it('acepta un correo válido', () => {
    expect(RequestPasswordResetSchema.safeParse({ email: 'ana@aps.cl' }).success).toBe(true);
  });

  it.each([
    ['sin correo', {}],
    ['correo inválido', { email: 'no-es-correo' }],
    ['correo de más de 254 caracteres', { email: `${'a'.repeat(250)}@aps.cl` }],
  ])('rechaza %s', (_case, body) => {
    expect(RequestPasswordResetSchema.safeParse(body).success).toBe(false);
  });
});

describe('ResetPasswordSchema', () => {
  it('acepta token y contraseña', () => {
    expect(ResetPasswordSchema.safeParse({ token: 'abc', password: 'x' }).success).toBe(true);
  });

  it('no aplica la política de fortaleza: eso es WEAK_PASSWORD del caso de uso (422, no 400)', () => {
    expect(ResetPasswordSchema.safeParse({ token: 'abc', password: 'corta' }).success).toBe(true);
  });

  it.each([
    ['sin token', { password: 'x' }],
    ['token vacío', { token: '', password: 'x' }],
    ['token de más de 200 caracteres', { token: 'a'.repeat(201), password: 'x' }],
    ['sin contraseña', { token: 'abc' }],
    ['contraseña vacía', { token: 'abc', password: '' }],
    ['contraseña de más de 128 caracteres', { token: 'abc', password: 'p'.repeat(129) }],
  ])('rechaza %s', (_case, body) => {
    expect(ResetPasswordSchema.safeParse(body).success).toBe(false);
  });
});

describe('PasswordResetSchema (respuesta)', () => {
  const base = { id: UUID, email: 'ana@aps.cl', expiresAt: '2026-01-15T13:00:00.000Z' };

  it('acepta id uuid, correo y expiresAt ISO', () => {
    expect(PasswordResetSchema.safeParse(base).success).toBe(true);
  });

  it('rechaza id que no es uuid o expiresAt que no es ISO', () => {
    expect(PasswordResetSchema.safeParse({ ...base, id: 'x' }).success).toBe(false);
    expect(PasswordResetSchema.safeParse({ ...base, expiresAt: 'mañana' }).success).toBe(false);
  });

  it('no declara campos de token (el token solo viaja por correo)', () => {
    expect(Object.keys(PasswordResetSchema.shape).sort()).toEqual(['email', 'expiresAt', 'id']);
  });
});

describe('params de las rutas forzadas', () => {
  it('exigen uuid en companyId, employeeId y userId', () => {
    const employeeParams = passwordResetRoutes.forceEmployeePasswordReset.params;
    const userParams = passwordResetRoutes.forceUserPasswordReset.params;

    expect(employeeParams.safeParse({ companyId: UUID, employeeId: UUID }).success).toBe(true);
    expect(employeeParams.safeParse({ companyId: 'x', employeeId: UUID }).success).toBe(false);
    expect(employeeParams.safeParse({ companyId: UUID, employeeId: 'x' }).success).toBe(false);
    expect(userParams.safeParse({ userId: UUID }).success).toBe(true);
    expect(userParams.safeParse({ userId: 'x' }).success).toBe(false);
  });
});
