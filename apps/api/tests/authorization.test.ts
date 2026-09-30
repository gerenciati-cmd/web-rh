import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import type { CompanyId } from '@/modules/organization/domain/company';

import { buildTestContainer, signInAs } from './test-app';

/**
 * Autorización de punta a punta (plan 002, ADR 0012): contrato → `bindRoute` (401/403) →
 * grants resueltos por petición → filtrado de filas. Persistencia en memoria, como `http.test.ts`.
 */
const NO_COMPANY = '00000000-0000-4000-8000-00000000dead';
const NO_USER = '00000000-0000-4000-8000-00000000beef';
const PASSWORD = 'contraseña-larga-y-valida';

const validCompany = { legalName: 'Gamma SA de CV', taxId: 'BBB020202BB2', country: 'MX' };

const employeeBody = {
  nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
  firstName: 'Ana',
  lastName: 'Rojas',
  email: 'ana@aps.cl',
  hireDate: '2026-01-10',
};

describe('autorización HTTP', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrToken: string;
  let noRoleToken: string;
  let companyA: string;
  let companyB: string;

  const as = (token: string | null) => ({
    get: (path: string) => withAuth(request(app).get(`${API_PREFIX}${path}`), token),
    post: (path: string) => withAuth(request(app).post(`${API_PREFIX}${path}`), token),
    delete: (path: string) => withAuth(request(app).delete(`${API_PREFIX}${path}`), token),
  });

  function withAuth<T extends request.Test>(test: T, token: string | null): T {
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  }

  async function createCompany(legalName: string, taxId: string): Promise<string> {
    const response = await as(adminToken)
      .post('/companies')
      .send({ legalName, taxId, country: 'MX' })
      .expect(201);
    return response.body.id as string;
  }

  async function userIdOf(token: string): Promise<string> {
    const me = await as(token).get('/auth/me').expect(200);
    return me.body.id as string;
  }

  /** Usuario registrado y con sesión, pero sin ninguna asignación de rol. */
  async function signInWithoutRole(): Promise<string> {
    const { registerUser, logIn } = container.cradle;
    const email = 'sin-rol@example.com';
    const registered = await registerUser.execute({ email, password: PASSWORD });
    if (!registered.ok) throw registered.error;
    const session = await logIn.execute({
      email,
      password: PASSWORD,
      client: 'mobile',
      ip: null,
      userAgent: null,
    });
    if (!session.ok) throw session.error;
    return session.value.token;
  }

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    companyA = await createCompany('Alfa SA de CV', 'EKU9003173C9');
    companyB = await createCompany('Beta SA de CV', 'AAA010101AAA');
    hrToken = await signInAs(container, { role: 'HR', companyId: companyA });
    noRoleToken = await signInWithoutRole();
  });

  describe('sin sesión: 401 AUTHENTICATION_REQUIRED en toda ruta de negocio', () => {
    const cases: [string, () => request.Test][] = [
      ['GET /companies', () => as(null).get('/companies')],
      ['POST /companies', () => as(null).post('/companies').send(validCompany)],
      ['GET /companies/:id', () => as(null).get(`/companies/${NO_COMPANY}`)],
      ['GET /companies/:id/employees', () => as(null).get(`/companies/${NO_COMPANY}/employees`)],
      [
        'POST /companies/:id/employees',
        () => as(null).post(`/companies/${NO_COMPANY}/employees`).send(employeeBody),
      ],
      ['GET /users', () => as(null).get('/users')],
      ['GET /users/:id/role-assignments', () => as(null).get(`/users/${NO_USER}/role-assignments`)],
      [
        'POST /users/:id/role-assignments',
        () => as(null).post(`/users/${NO_USER}/role-assignments`).send({ role: 'HR' }),
      ],
      [
        'DELETE /users/:id/role-assignments/:id',
        () => as(null).delete(`/users/${NO_USER}/role-assignments/${NO_USER}`),
      ],
      ['GET /auth/me', () => as(null).get('/auth/me')],
      ['POST /auth/logout', () => as(null).post('/auth/logout')],
    ];

    it.each(cases)('%s', async (_name, call) => {
      const response = await call().expect(401);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('un token inventado también es 401', async () => {
      await as('token-inventado').get('/companies').expect(401);
    });

    it('POST /auth/login sigue siendo público', async () => {
      const response = await as(null)
        .post('/auth/login')
        .send({ email: 'nadie@example.com', password: PASSWORD, client: 'web' });

      expect(response.status).toBe(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('/health/live sigue abierto', async () => {
      await request(app).get('/health/live').expect(200);
    });

    // R1 (ronda de reparación 1): `bindRoute` valida `params`, autoriza y solo entonces valida
    // `query`/`body`, así que un anónimo nunca ve el detalle del esquema de entrada.
    it('anónimo con body inválido recibe 401, no 400 (autoriza antes de validar body)', async () => {
      const response = await as(null).post('/companies').send({}).expect(401);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('anónimo con query inválida recibe 401, no 400 (autoriza antes de validar query)', async () => {
      const response = await as(null).get('/users?page=0').expect(401);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('anónimo con :userId inválido recibe 400: el param de path se valida ANTES de autenticar', async () => {
      // Por diseño (ADR 0012): `companyParam` sale de los params, así que se parsean primero.
      const response = await as(null).get('/users/no-es-uuid/role-assignments').expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('usuario sin asignaciones: 403 FORBIDDEN en negocio y 200 en /auth/me', () => {
    it('/auth/me responde 200', async () => {
      await as(noRoleToken).get('/auth/me').expect(200);
    });

    const cases: [string, () => request.Test][] = [
      ['GET /companies', () => as(noRoleToken).get('/companies')],
      ['POST /companies', () => as(noRoleToken).post('/companies').send(validCompany)],
      ['GET /companies/:id', () => as(noRoleToken).get(`/companies/${companyA}`)],
      [
        'GET /companies/:id/employees',
        () => as(noRoleToken).get(`/companies/${companyA}/employees`),
      ],
      [
        'POST /companies/:id/employees',
        () => as(noRoleToken).post(`/companies/${companyA}/employees`).send(employeeBody),
      ],
      ['GET /users', () => as(noRoleToken).get('/users')],
      [
        'GET /users/:id/role-assignments',
        () => as(noRoleToken).get(`/users/${NO_USER}/role-assignments`),
      ],
      [
        'POST /users/:id/role-assignments',
        () => as(noRoleToken).post(`/users/${NO_USER}/role-assignments`).send({ role: 'HR' }),
      ],
      [
        'DELETE /users/:id/role-assignments/:id',
        () => as(noRoleToken).delete(`/users/${NO_USER}/role-assignments/${NO_USER}`),
      ],
    ];

    it.each(cases)('%s', async (_name, call) => {
      const response = await call().expect(403);
      expect(response.body).toEqual({
        code: 'FORBIDDEN',
        message: 'No tienes permiso para esta acción',
      });
    });
  });

  describe('HR de la empresa A', () => {
    it('GET /companies devuelve solo su empresa', async () => {
      const response = await as(hrToken).get('/companies').expect(200);

      expect(response.body.total).toBe(1);
      const ids = (response.body.items as { id: string }[]).map((c) => c.id);
      expect(ids).toEqual([companyA]);
    });

    it('GET /companies/:id de su empresa: 200', async () => {
      await as(hrToken).get(`/companies/${companyA}`).expect(200);
    });

    it('lista y registra colaboradores en su empresa', async () => {
      await as(hrToken).post(`/companies/${companyA}/employees`).send(employeeBody).expect(201);
      const list = await as(hrToken).get(`/companies/${companyA}/employees`).expect(200);

      expect(list.body.total).toBe(1);
    });

    it.each([
      ['GET /companies/:id', (id: string) => as(hrToken).get(`/companies/${id}`)],
      [
        'GET /companies/:id/employees',
        (id: string) => as(hrToken).get(`/companies/${id}/employees`),
      ],
      [
        'POST /companies/:id/employees',
        (id: string) => as(hrToken).post(`/companies/${id}/employees`).send(employeeBody),
      ],
    ])('%s en otra empresa: 403 FORBIDDEN', async (_name, call) => {
      const response = await call(companyB).expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it.each([
      ['GET /companies/:id', (id: string) => as(hrToken).get(`/companies/${id}`)],
      [
        'GET /companies/:id/employees',
        (id: string) => as(hrToken).get(`/companies/${id}/employees`),
      ],
      [
        'POST /companies/:id/employees',
        (id: string) => as(hrToken).post(`/companies/${id}/employees`).send(employeeBody),
      ],
    ])('%s en una empresa inexistente: 403, no 404 (no se sondea)', async (_name, call) => {
      const response = await call(NO_COMPANY).expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('con body o query inválidos recibe 403, no 400 (autoriza antes de validar)', async () => {
      const post = await as(hrToken).post('/companies').send({}).expect(403);
      expect(post.body.code).toBe('FORBIDDEN');
      await as(hrToken).get('/users?page=0').expect(403);
      await as(hrToken).post(`/companies/${companyB}/employees`).send({}).expect(403);
    });

    it('POST /companies, GET /users y las rutas de roles: 403', async () => {
      await as(hrToken)
        .post('/companies')
        .send({ legalName: 'X SA', taxId: 'BBB020202BB2', country: 'MX' })
        .expect(403);
      await as(hrToken).get('/users').expect(403);
      await as(hrToken).get(`/users/${NO_USER}/role-assignments`).expect(403);
      await as(hrToken).post(`/users/${NO_USER}/role-assignments`).send({ role: 'HR' }).expect(403);
      await as(hrToken).delete(`/users/${NO_USER}/role-assignments/${NO_USER}`).expect(403);
    });
  });

  describe('HOLDING_ADMIN', () => {
    it('con permiso, body o query inválidos sí son 400 VALIDATION_ERROR', async () => {
      const post = await as(adminToken).post('/companies').send({}).expect(400);
      expect(post.body.code).toBe('VALIDATION_ERROR');
      await as(adminToken).get('/users?page=0').expect(400);
    });

    it('GET /companies devuelve todas', async () => {
      const response = await as(adminToken).get('/companies').expect(200);

      expect(response.body.total).toBe(2);
    });

    it('accede a cualquier empresa y a las rutas de usuarios', async () => {
      await as(adminToken).get(`/companies/${companyB}`).expect(200);
      await as(adminToken).get(`/companies/${companyB}/employees`).expect(200);
      await as(adminToken).get('/users').expect(200);
    });

    it('una empresa inexistente sí es 404 para quien tiene alcance', async () => {
      const response = await as(adminToken).get(`/companies/${NO_COMPANY}`).expect(404);
      expect(response.body.code).toBe('COMPANY_NOT_FOUND');
    });
  });

  describe('GET /users', () => {
    it('lista usuarios y filtra por search', async () => {
      const all = await as(adminToken).get('/users').expect(200);
      expect(all.body.total).toBe(3);

      const filtered = await as(adminToken).get('/users?search=sin-rol').expect(200);
      expect(filtered.body.items).toEqual([
        expect.objectContaining({ email: 'sin-rol@example.com', status: 'ACTIVE' }),
      ]);
    });
  });

  describe('asignación de roles', () => {
    let targetId: string;

    beforeEach(async () => {
      targetId = await userIdOf(noRoleToken);
    });

    const assign = (body: object, userId = () => targetId) =>
      as(adminToken).post(`/users/${userId()}/role-assignments`).send(body);

    it('HR con una empresa activa: 201 y la asignación queda listada', async () => {
      const created = await assign({ role: 'HR', companyId: companyA }).expect(201);

      const list = await as(adminToken).get(`/users/${targetId}/role-assignments`).expect(200);
      expect(list.body).toEqual([
        expect.objectContaining({ id: created.body.id, role: 'HR', companyId: companyA }),
      ]);
    });

    it('la asignación rige desde la siguiente petición del usuario', async () => {
      await as(noRoleToken).get(`/companies/${companyA}`).expect(403);

      await assign({ role: 'HR', companyId: companyA }).expect(201);

      await as(noRoleToken).get(`/companies/${companyA}`).expect(200);
      await as(noRoleToken).get(`/companies/${companyB}`).expect(403);
    });

    it.each([
      ['HR sin empresa', { role: 'HR' }, 422, 'INVALID_ROLE_SCOPE'],
      [
        'HOLDING_ADMIN con empresa',
        { role: 'HOLDING_ADMIN', companyId: NO_COMPANY },
        422,
        'INVALID_ROLE_SCOPE',
      ],
      ['DIRECT_MANAGER', { role: 'DIRECT_MANAGER' }, 422, 'ROLE_NOT_ASSIGNABLE'],
      ['EMPLOYEE', { role: 'EMPLOYEE' }, 422, 'ROLE_NOT_ASSIGNABLE'],
      ['empresa desconocida', { role: 'HR', companyId: NO_COMPANY }, 404, 'COMPANY_NOT_FOUND'],
    ])('%s: %i %s', async (_name, body, status, code) => {
      const response = await assign(body).expect(status);
      expect(response.body.code).toBe(code);
    });

    it('empresa inactiva: 422 COMPANY_INACTIVE', async () => {
      const inactive = await createCompany('Gamma SA de CV', 'BBB020202BB2');
      const company = await container.cradle.companyRepository.findById(inactive as CompanyId);
      if (!company) throw new Error('fixture: empresa no encontrada');
      company.deactivate();
      await container.cradle.companyRepository.save(company);

      const response = await assign({ role: 'HR', companyId: inactive }).expect(422);

      expect(response.body.code).toBe('COMPANY_INACTIVE');
    });

    it('usuario inexistente: 404 USER_NOT_FOUND', async () => {
      const response = await as(adminToken)
        .post(`/users/${NO_USER}/role-assignments`)
        .send({ role: 'HR', companyId: companyA })
        .expect(404);
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });

    it('duplicado activo: 409 ROLE_ALREADY_ASSIGNED', async () => {
      await assign({ role: 'HR', companyId: companyA }).expect(201);

      const response = await assign({ role: 'HR', companyId: companyA }).expect(409);

      expect(response.body.code).toBe('ROLE_ALREADY_ASSIGNED');
    });

    it('400 VALIDATION_ERROR con un rol fuera del catálogo o un companyId no uuid', async () => {
      await assign({ role: 'SUPERADMIN' }).expect(400);
      await assign({ role: 'HR', companyId: 'no-uuid' }).expect(400);
    });

    it('GET de asignaciones de un usuario inexistente: 404 USER_NOT_FOUND', async () => {
      const response = await as(adminToken).get(`/users/${NO_USER}/role-assignments`).expect(404);
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });

    it('quien recibe HOLDING_ADMIN gana acceso a las rutas de usuarios', async () => {
      await as(noRoleToken).get('/users').expect(403);

      await assign({ role: 'HOLDING_ADMIN' }).expect(201);

      await as(noRoleToken).get('/users').expect(200);
    });
  });

  describe('revocación de roles', () => {
    it('204 y la pérdida se refleja en la siguiente petición del usuario (403)', async () => {
      const hrId = await userIdOf(hrToken);
      await as(hrToken).get(`/companies/${companyA}`).expect(200);
      const list = await as(adminToken).get(`/users/${hrId}/role-assignments`).expect(200);
      const assignmentId = list.body[0].id as string;

      await as(adminToken).delete(`/users/${hrId}/role-assignments/${assignmentId}`).expect(204);

      await as(hrToken).get(`/companies/${companyA}`).expect(403);
      const after = await as(adminToken).get(`/users/${hrId}/role-assignments`).expect(200);
      expect(after.body).toEqual([]);
    });

    it('la fila queda con revokedAt/revokedBy (historial, no borrado)', async () => {
      const hrId = await userIdOf(hrToken);
      const adminId = await userIdOf(adminToken);
      const list = await as(adminToken).get(`/users/${hrId}/role-assignments`).expect(200);
      const assignmentId = list.body[0].id as string;

      await as(adminToken).delete(`/users/${hrId}/role-assignments/${assignmentId}`).expect(204);

      const stored = await container.cradle.roleAssignmentRepository.findById(
        assignmentId as never,
      );
      expect(stored?.snapshot.revokedAt).toBeInstanceOf(Date);
      expect(stored?.snapshot.revokedBy).toBe(adminId);
    });

    it('el único HOLDING_ADMIN activo no se puede revocar: 422 LAST_HOLDING_ADMIN', async () => {
      const adminId = await userIdOf(adminToken);
      const list = await as(adminToken).get(`/users/${adminId}/role-assignments`).expect(200);

      const response = await as(adminToken)
        .delete(`/users/${adminId}/role-assignments/${list.body[0].id}`)
        .expect(422);

      expect(response.body.code).toBe('LAST_HOLDING_ADMIN');
      await as(adminToken).get('/users').expect(200);
    });

    it('con un segundo HOLDING_ADMIN sí se puede revocar al primero', async () => {
      const secondAdminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
      const adminId = await userIdOf(adminToken);
      const list = await as(secondAdminToken).get(`/users/${adminId}/role-assignments`).expect(200);

      await as(secondAdminToken)
        .delete(`/users/${adminId}/role-assignments/${list.body[0].id}`)
        .expect(204);

      await as(adminToken).get('/users').expect(403);
    });

    it('asignación ya revocada: 404 ROLE_ASSIGNMENT_NOT_FOUND', async () => {
      const hrId = await userIdOf(hrToken);
      const list = await as(adminToken).get(`/users/${hrId}/role-assignments`).expect(200);
      const path = `/users/${hrId}/role-assignments/${list.body[0].id}`;
      await as(adminToken).delete(path).expect(204);

      const response = await as(adminToken).delete(path).expect(404);

      expect(response.body.code).toBe('ROLE_ASSIGNMENT_NOT_FOUND');
    });

    it('id de asignación ajeno al usuario de la ruta: 404 ROLE_ASSIGNMENT_NOT_FOUND', async () => {
      const hrId = await userIdOf(hrToken);
      const adminId = await userIdOf(adminToken);
      const list = await as(adminToken).get(`/users/${hrId}/role-assignments`).expect(200);

      const response = await as(adminToken)
        .delete(`/users/${adminId}/role-assignments/${list.body[0].id}`)
        .expect(404);

      expect(response.body.code).toBe('ROLE_ASSIGNMENT_NOT_FOUND');
      await as(hrToken).get(`/companies/${companyA}`).expect(200);
    });
  });

  describe('OpenAPI', () => {
    it('GET /openapi.json: login sin seguridad, negocio con x-permission y 403 en Error', async () => {
      const response = await request(app).get(`${API_PREFIX}/openapi.json`).expect(200);

      expect(response.body.paths['/auth/login'].post.security).toEqual([]);
      expect(response.body.paths['/companies'].get['x-permission']).toBe(
        'organization.companies:read',
      );
      expect(response.body.components.responses.Error.description).toContain('403');
    });
  });
});
