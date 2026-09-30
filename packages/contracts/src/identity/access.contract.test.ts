import { PERMISSIONS, ROLES } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { apiRoutes, buildOpenApiDocument, type RouteDefinition } from '../index';

import {
  AssignRoleSchema,
  ListUsersQuerySchema,
  RoleAssignmentSchema,
  UserListItemSchema,
  accessRoutes,
} from './access.contract';

const allRoutes = Object.entries(apiRoutes).flatMap(([group, routes]) =>
  Object.entries(routes as Record<string, RouteDefinition>).map(
    ([name, route]) => [`${group}.${name}`, route] as const,
  ),
);

describe('access de cada ruta (negado por defecto)', () => {
  it.each(allRoutes)('%s declara access', (_name, route) => {
    expect(route.access).toBeDefined();
    expect(['public', 'authenticated', 'permission']).toContain(route.access.kind);
  });

  it('solo /auth/login es pública', () => {
    const publicRoutes = allRoutes
      .filter(([, route]) => route.access.kind === 'public')
      .map(([name]) => name);

    expect(publicRoutes).toEqual(['identity.logIn']);
  });

  it('logOut y me exigen solo sesión', () => {
    expect(apiRoutes.identity.logOut.access).toEqual({ kind: 'authenticated' });
    expect(apiRoutes.identity.me.access).toEqual({ kind: 'authenticated' });
  });

  it('las rutas de negocio declaran el permiso y el parámetro de empresa esperados', () => {
    expect(apiRoutes.organization.listCompanies.access).toEqual({
      kind: 'permission',
      permission: 'organization.companies:read',
    });
    expect(apiRoutes.organization.getCompany.access).toEqual({
      kind: 'permission',
      permission: 'organization.companies:read',
      companyParam: 'companyId',
    });
    expect(apiRoutes.organization.createCompany.access).toEqual({
      kind: 'permission',
      permission: 'organization.companies:create',
    });
    expect(apiRoutes.employees.listEmployees.access).toEqual({
      kind: 'permission',
      permission: 'employees:read',
      companyParam: 'companyId',
    });
    expect(apiRoutes.employees.registerEmployee.access).toEqual({
      kind: 'permission',
      permission: 'employees:register',
      companyParam: 'companyId',
    });
  });

  it('todo companyParam declarado existe como propiedad de params en su ruta', () => {
    for (const [name, route] of allRoutes) {
      if (route.access.kind !== 'permission' || route.access.companyParam === undefined) continue;
      expect(route.path, name).toContain(`:${route.access.companyParam}`);
    }
  });

  it('todo permiso usado pertenece al vocabulario compartido', () => {
    for (const [, route] of allRoutes) {
      if (route.access.kind === 'permission')
        expect(PERMISSIONS).toContain(route.access.permission);
    }
  });
});

describe('accessRoutes', () => {
  it('listUsers, listRoleAssignments, assignRole, revokeRoleAssignment: método, path, status y permiso', () => {
    expect(accessRoutes.listUsers).toMatchObject({
      method: 'GET',
      path: '/users',
      access: { kind: 'permission', permission: 'identity.users:read' },
    });
    expect(accessRoutes.listRoleAssignments).toMatchObject({
      method: 'GET',
      path: '/users/:userId/role-assignments',
      access: { kind: 'permission', permission: 'identity.roles:manage' },
    });
    expect(accessRoutes.assignRole).toMatchObject({
      method: 'POST',
      path: '/users/:userId/role-assignments',
      successStatus: 201,
      access: { kind: 'permission', permission: 'identity.roles:manage' },
    });
    expect(accessRoutes.revokeRoleAssignment).toMatchObject({
      method: 'DELETE',
      path: '/users/:userId/role-assignments/:assignmentId',
      successStatus: 204,
      access: { kind: 'permission', permission: 'identity.roles:manage' },
    });
  });

  it('están registradas en apiRoutes.access', () => {
    expect(apiRoutes.access).toBe(accessRoutes);
  });
});

describe('AssignRoleSchema', () => {
  it.each(ROLES)('acepta el rol %s del vocabulario', (role) => {
    expect(AssignRoleSchema.safeParse({ role }).success).toBe(true);
  });

  it('rechaza un rol fuera del vocabulario', () => {
    expect(AssignRoleSchema.safeParse({ role: 'SUPERADMIN' }).success).toBe(false);
  });

  it('companyId es opcional pero debe ser uuid', () => {
    const companyId = '00000000-0000-4000-8000-000000000001';
    expect(AssignRoleSchema.safeParse({ role: 'HR', companyId }).success).toBe(true);
    expect(AssignRoleSchema.safeParse({ role: 'HR', companyId: 'no-uuid' }).success).toBe(false);
  });

  it('rechaza un body sin rol', () => {
    expect(AssignRoleSchema.safeParse({}).success).toBe(false);
  });
});

describe('ListUsersQuerySchema', () => {
  it('aplica los defaults de paginación y search es opcional', () => {
    const parsed = ListUsersQuerySchema.parse({});

    expect(parsed.page).toBe(1);
    expect(parsed.search).toBeUndefined();
  });

  it('recorta espacios de search y rechaza uno vacío', () => {
    expect(ListUsersQuerySchema.parse({ search: '  ana ' }).search).toBe('ana');
    expect(ListUsersQuerySchema.safeParse({ search: '   ' }).success).toBe(false);
  });
});

describe('esquemas de respuesta', () => {
  it('UserListItem acepta ACTIVE/DISABLED y rechaza otro estado o un email inválido', () => {
    const base = { id: '00000000-0000-4000-8000-000000000001', email: 'ana@aps.cl' };

    expect(UserListItemSchema.safeParse({ ...base, status: 'ACTIVE' }).success).toBe(true);
    expect(UserListItemSchema.safeParse({ ...base, status: 'DISABLED' }).success).toBe(true);
    expect(UserListItemSchema.safeParse({ ...base, status: 'LOCKED' }).success).toBe(false);
    expect(UserListItemSchema.safeParse({ ...base, email: 'x', status: 'ACTIVE' }).success).toBe(
      false,
    );
  });

  it('RoleAssignment acepta companyId null (holding) y exige assignedAt ISO', () => {
    const base = {
      id: '00000000-0000-4000-8000-000000000001',
      role: 'HOLDING_ADMIN',
      companyId: null,
    };

    expect(
      RoleAssignmentSchema.safeParse({ ...base, assignedAt: '2026-01-15T12:00:00.000Z' }).success,
    ).toBe(true);
    expect(RoleAssignmentSchema.safeParse({ ...base, assignedAt: 'ayer' }).success).toBe(false);
  });
});

describe('OpenAPI: seguridad por operación', () => {
  interface Operation {
    security?: unknown[];
    'x-permission'?: string;
    'x-company-param'?: string;
  }
  const document = buildOpenApiDocument(apiRoutes) as {
    paths: Record<string, Record<string, Operation>>;
    security: unknown[];
    components: { responses: { Error: { description: string } } };
  };

  it('la seguridad global no admite anónimos (sin {})', () => {
    expect(document.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
  });

  it('/auth/login declara security: [] (pública)', () => {
    expect(document.paths['/auth/login']?.post?.security).toEqual([]);
  });

  it('las rutas autenticadas no sobreescriben security ni llevan x-permission', () => {
    const me = document.paths['/auth/me']?.get;

    expect(me).not.toHaveProperty('security');
    expect(me).not.toHaveProperty('x-permission');
  });

  it('las operaciones de negocio llevan x-permission y, si aplica, x-company-param', () => {
    expect(document.paths['/companies']?.get?.['x-permission']).toBe('organization.companies:read');
    expect(document.paths['/companies']?.get).not.toHaveProperty('x-company-param');
    expect(document.paths['/companies/{companyId}']?.get).toMatchObject({
      'x-permission': 'organization.companies:read',
      'x-company-param': 'companyId',
    });
    expect(document.paths['/companies/{companyId}/employees']?.post).toMatchObject({
      'x-permission': 'employees:register',
      'x-company-param': 'companyId',
    });
    expect(document.paths['/users']?.get?.['x-permission']).toBe('identity.users:read');
    expect(document.paths['/users/{userId}/role-assignments']?.post?.['x-permission']).toBe(
      'identity.roles:manage',
    );
  });

  it('la respuesta Error menciona el 403', () => {
    expect(document.components.responses.Error.description).toContain('403');
  });
});
