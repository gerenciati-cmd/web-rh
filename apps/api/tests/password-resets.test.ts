import { Email, NationalId, PersonalRfc } from '@rrhh/domain';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { Employee, type EmployeeId } from '@/modules/employees/domain/employee';
import type { InMemoryEmployeeRepository } from '@/modules/employees/infrastructure/in-memory/in-memory-employee.repository';
import { SEND_INVITATION_EMAIL } from '@/modules/identity/application/jobs/send-invitation-email.job';
import { SEND_PASSWORD_RESET_EMAIL } from '@/modules/identity/application/jobs/send-password-reset-email.job';
import { PasswordReset } from '@/modules/identity/domain/password-reset';
import type { InMemoryPasswordResetRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-password-reset.repository';
import type { InMemoryUserRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-user.repository';
import type { RecordingJobQueue } from '@/shared/testing/fakes';

import { buildTestContainer, signInAs } from './test-app';

/**
 * Restablecimiento de contraseña (plan 005): contrato -> `bindRoute` -> casos de uso. Persistencia,
 * cola y correo en memoria.
 */
const PASSWORD = 'contraseña-larga-y-valida';
const NEW_PASSWORD = 'contraseña-nueva-y-valida';
const NO_EMPLOYEE = '00000000-0000-4000-8000-00000000dead';
const NO_USER = '00000000-0000-4000-8000-00000000beef';
const CURP = 'GOMA850101HQRRRN04';
let rfcSequence = 0;

describe('restablecimiento de contraseña — HTTP', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrToken: string;
  let hrOtherCompanyToken: string;
  let companyA: string;
  let companyB: string;
  let ana: string;

  const as = (token: string | null) => ({
    get: (path: string) => withAuth(request(app).get(`${API_PREFIX}${path}`), token),
    post: (path: string) => withAuth(request(app).post(`${API_PREFIX}${path}`), token),
  });

  function withAuth<T extends request.Test>(test: T, token: string | null): T {
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  }

  const jobQueue = () => container.cradle.jobQueue as RecordingJobQueue;
  const employeeRepository = () =>
    container.cradle.employeeRepository as InMemoryEmployeeRepository;
  const userRepository = () => container.cradle.userRepository as InMemoryUserRepository;
  const resetRepository = () =>
    container.cradle.passwordResetRepository as InMemoryPasswordResetRepository;

  const resetJobs = () => jobQueue().jobs.filter((job) => job.name === SEND_PASSWORD_RESET_EMAIL);

  async function createCompany(legalName: string, taxId: string): Promise<string> {
    const response = await as(adminToken)
      .post('/companies')
      .send({ legalName, taxId, country: 'MX' })
      .expect(201);
    return response.body.id as string;
  }

  async function hire(
    companyId: string,
    rawEmail: string,
    id: string,
    curp = CURP,
  ): Promise<string> {
    const nationalId = NationalId.create('MX', curp);
    const email = Email.create(rawEmail);
    if (!nationalId.ok) throw nationalId.error;
    if (!email.ok) throw email.error;
    // Mismo CURP en dos empresas, pero el RFC es único en el holding: homoclave distinta por alta.
    const rfc = PersonalRfc.create(
      `${curp.slice(0, 10)}A${String(++rfcSequence).padStart(2, '0')}`,
    );
    if (!rfc.ok) throw rfc.error;
    const employee = Employee.hire({
      id: id as EmployeeId,
      companyId,
      nationalId: nationalId.value,
      rfc: rfc.value,
      firstName: 'Ana',
      lastName: 'Rojas',
      email: email.value,
      hireDate: new Date('2026-01-10'),
      now: new Date('2026-01-15T12:00:00Z'),
    });
    if (!employee.ok) throw employee.error;
    const saved = await employeeRepository().save(employee.value);
    if (!saved.ok) throw saved.error;
    return employee.value.id;
  }

  /** Token en claro del último correo de restablecimiento encolado (lo único que lo contiene). */
  function lastToken(): string {
    const link = (resetJobs().at(-1)?.data as { link: string } | undefined)?.link;
    if (!link) throw new Error('no se encoló ningún correo de restablecimiento');
    return new URL(link).searchParams.get('token') ?? '';
  }

  /** Activa la cuenta de un colaborador por el flujo real de invitación. */
  async function activateAccount(companyId: string, employeeId: string): Promise<void> {
    await as(hrToken)
      .post(`/companies/${companyId}/employees/${employeeId}/invitations`)
      .send({})
      .expect(201);
    const link = (
      jobQueue()
        .jobs.filter((job) => job.name === SEND_INVITATION_EMAIL)
        .at(-1)?.data as {
        link: string;
      }
    ).link;
    const token = new URL(link).searchParams.get('token');
    await request(app)
      .post(`${API_PREFIX}/auth/activate`)
      .send({ token, password: PASSWORD })
      .expect(204);
    jobQueue().jobs.length = 0;
  }

  const forgot = (email: string) =>
    request(app).post(`${API_PREFIX}/auth/password-reset`).send({ email });
  const confirm = (body: object) =>
    request(app).post(`${API_PREFIX}/auth/password-reset/confirm`).send(body);
  const login = (email: string, password: string) =>
    request(app).post(`${API_PREFIX}/auth/login`).send({ email, password, client: 'mobile' });
  const forceEmployee = (token: string | null, companyId: string, employeeId: string) =>
    as(token).post(`/companies/${companyId}/employees/${employeeId}/password-reset`);
  const forceUser = (token: string | null, userId: string) =>
    as(token).post(`/users/${userId}/password-reset`);

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    companyA = await createCompany('Alfa SA de CV', 'EKU9003173C9');
    companyB = await createCompany('Beta SA de CV', 'AAA010101AAA');
    hrToken = await signInAs(container, { role: 'HR', companyId: companyA });
    hrOtherCompanyToken = await signInAs(container, { role: 'HR', companyId: companyB });
    ana = await hire(companyA, 'ana@aps.cl', '00000000-0000-4000-8000-00000000a001');
    await activateAccount(companyA, ana);
  });

  describe('POST /auth/password-reset', () => {
    it('usuario activo: 204 con cuerpo vacío y un correo sensible con enlace a /restablecer', async () => {
      const response = await forgot('ana@aps.cl').expect(204);

      expect(response.text).toBe('');
      expect(resetJobs()).toHaveLength(1);
      expect(resetJobs()[0]?.options).toEqual({ sensitive: true });
      expect(resetJobs()[0]?.data).toMatchObject({ to: 'ana@aps.cl', forcedByStaff: false });
      expect(new URL((resetJobs()[0]?.data as { link: string }).link).pathname).toBe(
        '/restablecer',
      );
    });

    it('correo desconocido: 204 idéntico y no se encola nada', async () => {
      const known = await forgot('ana@aps.cl').expect(204);
      jobQueue().jobs.length = 0;

      const unknown = await forgot('nadie@aps.cl').expect(204);

      expect(unknown.text).toBe(known.text);
      expect(unknown.headers['set-cookie']).toBeUndefined();
      expect(resetJobs()).toEqual([]);
    });

    it('usuario deshabilitado: 204 y no se encola nada', async () => {
      const user = await userRepository().findByEmployeeId(ana);
      user?.disable(new Date());

      const response = await forgot('ana@aps.cl').expect(204);

      expect(response.text).toBe('');
      expect(resetJobs()).toEqual([]);
    });

    it('segunda solicitud dentro del cooldown: 204 pero un solo correo', async () => {
      await forgot('ana@aps.cl').expect(204);

      await forgot('ana@aps.cl').expect(204);

      expect(resetJobs()).toHaveLength(1);
      expect(resetRepository().resets.size).toBe(1);
    });

    it('correo con formato inválido o body sin correo: 400 VALIDATION_ERROR', async () => {
      const malformed = await forgot('no-es-correo').expect(400);
      const missing = await request(app)
        .post(`${API_PREFIX}/auth/password-reset`)
        .send({})
        .expect(400);

      expect(malformed.body.code).toBe('VALIDATION_ERROR');
      expect(missing.body.code).toBe('VALIDATION_ERROR');
    });

    it('no requiere sesión: es pública', async () => {
      await forgot('nadie@aps.cl').expect(204);
    });
  });

  describe('POST /auth/password-reset/confirm', () => {
    it('token y contraseña válidos: 204 sin cuerpo ni cookie (no abre sesión)', async () => {
      await forgot('ana@aps.cl').expect(204);

      const response = await confirm({ token: lastToken(), password: NEW_PASSWORD }).expect(204);

      expect(response.text).toBe('');
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('después: el login con la contraseña nueva funciona y la anterior da 401', async () => {
      await forgot('ana@aps.cl').expect(204);
      await confirm({ token: lastToken(), password: NEW_PASSWORD }).expect(204);

      await login('ana@aps.cl', NEW_PASSWORD).expect(200);
      const old = await login('ana@aps.cl', PASSWORD).expect(401);

      expect(old.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('toda sesión previa del usuario da 401 y las de otros siguen vivas', async () => {
      const before = await login('ana@aps.cl', PASSWORD).expect(200);
      const beforeToken = before.body.token as string;
      await as(beforeToken).get('/auth/me').expect(200);
      await forgot('ana@aps.cl').expect(204);

      await confirm({ token: lastToken(), password: NEW_PASSWORD }).expect(204);

      const response = await as(beforeToken).get('/auth/me').expect(401);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
      await as(adminToken).get('/auth/me').expect(200);
    });

    it('correo bloqueado por intentos fallidos (429): tras el restablecimiento el login con la contraseña nueva funciona', async () => {
      await forgot('ana@aps.cl').expect(204);
      for (let i = 0; i < 5; i++) await login('ana@aps.cl', 'incorrecta-xx').expect(401);
      const blocked = await login('ana@aps.cl', PASSWORD).expect(429);
      expect(blocked.body.code).toBe('LOGIN_TEMPORARILY_BLOCKED');

      await confirm({ token: lastToken(), password: NEW_PASSWORD }).expect(204);

      await login('ana@aps.cl', NEW_PASSWORD).expect(200);
    });

    it('segundo uso del mismo token: 422 PASSWORD_RESET_NOT_VALID y la contraseña no vuelve a cambiar', async () => {
      await forgot('ana@aps.cl').expect(204);
      const token = lastToken();
      await confirm({ token, password: NEW_PASSWORD }).expect(204);

      const response = await confirm({ token, password: 'otra-contraseña-larga-xx' }).expect(422);

      expect(response.body.code).toBe('PASSWORD_RESET_NOT_VALID');
      await login('ana@aps.cl', NEW_PASSWORD).expect(200);
    });

    it('token desconocido, usado, reemplazado y expirado: mismo cuerpo 422', async () => {
      await forceEmployee(hrToken, companyA, ana).expect(201);
      const superseded = lastToken();
      await forceEmployee(hrToken, companyA, ana).expect(201);
      const used = lastToken();
      await confirm({ token: used, password: NEW_PASSWORD }).expect(204);
      await forceEmployee(hrToken, companyA, ana).expect(201);
      const expired = lastToken();
      const [stored] = [...resetRepository().resets.values()].filter((reset) =>
        reset.isPendingAt(new Date()),
      );
      if (!stored) throw new Error('fixture: restablecimiento pendiente no encontrado');
      // Sin tocar el reloj del contenedor: se adelanta el vencimiento de la fila guardada.
      resetRepository().resets.set(
        stored.id,
        PasswordReset.restore(stored.id, {
          ...stored.snapshot,
          expiresAt: new Date('2000-01-01T00:00:00Z'),
        }),
      );

      const bodies = await Promise.all(
        ['token-inventado', used, superseded, expired].map(async (token) => {
          const response = await confirm({ token, password: NEW_PASSWORD }).expect(422);
          return response.body as unknown;
        }),
      );

      for (const body of bodies) expect(body).toEqual(bodies[0]);
      expect(bodies[0]).toMatchObject({ code: 'PASSWORD_RESET_NOT_VALID' });
    });

    it('usuario deshabilitado después de la solicitud: 422 PASSWORD_RESET_NOT_VALID', async () => {
      await forgot('ana@aps.cl').expect(204);
      const user = await userRepository().findByEmployeeId(ana);
      user?.disable(new Date());

      const response = await confirm({ token: lastToken(), password: NEW_PASSWORD }).expect(422);

      expect(response.body.code).toBe('PASSWORD_RESET_NOT_VALID');
    });

    it('contraseña débil: 422 WEAK_PASSWORD y el token sigue sirviendo', async () => {
      await forgot('ana@aps.cl').expect(204);
      const token = lastToken();

      const weak = await confirm({ token, password: 'corta' }).expect(422);

      expect(weak.body.code).toBe('WEAK_PASSWORD');
      await confirm({ token, password: NEW_PASSWORD }).expect(204);
    });

    it('una nueva solicitud (tras el cooldown) reemplaza la anterior: el token viejo ya no sirve', async () => {
      await forceEmployee(hrToken, companyA, ana).expect(201);
      const oldToken = lastToken();
      await forceEmployee(hrToken, companyA, ana).expect(201);
      const newToken = lastToken();

      const old = await confirm({ token: oldToken, password: NEW_PASSWORD }).expect(422);

      expect(old.body.code).toBe('PASSWORD_RESET_NOT_VALID');
      await confirm({ token: newToken, password: NEW_PASSWORD }).expect(204);
    });

    it('body inválido (sin token): 400 VALIDATION_ERROR', async () => {
      const response = await confirm({ password: NEW_PASSWORD }).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('no requiere sesión: es pública', async () => {
      const response = await confirm({ token: 'x', password: NEW_PASSWORD });

      expect(response.status).toBe(422);
    });
  });

  describe('POST /companies/:companyId/employees/:employeeId/password-reset', () => {
    it('HR de la empresa: 201 con id, correo de la cuenta y expiresAt; el correo dice que lo forzó personal', async () => {
      const response = await forceEmployee(hrToken, companyA, ana).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        email: 'ana@aps.cl',
        expiresAt: expect.any(String),
      });
      expect(resetJobs()).toHaveLength(1);
      expect(resetJobs()[0]?.options).toEqual({ sensitive: true });
      expect(resetJobs()[0]?.data).toMatchObject({ to: 'ana@aps.cl', forcedByStaff: true });
    });

    it('la respuesta nunca incluye el token', async () => {
      const response = await forceEmployee(hrToken, companyA, ana).expect(201);

      expect(JSON.stringify(response.body)).not.toContain(lastToken());
    });

    it('el enlace forzado permite fijar la contraseña; el personal nunca la fija', async () => {
      await forceEmployee(hrToken, companyA, ana).expect(201);

      await confirm({ token: lastToken(), password: NEW_PASSWORD }).expect(204);

      await login('ana@aps.cl', NEW_PASSWORD).expect(200);
    });

    it('el cooldown no aplica: dos forzados seguidos encolan dos correos', async () => {
      await forceEmployee(hrToken, companyA, ana).expect(201);
      await forceEmployee(hrToken, companyA, ana).expect(201);

      expect(resetJobs()).toHaveLength(2);
    });

    it('Admin holding también puede forzar a un colaborador de cualquier empresa', async () => {
      await forceEmployee(adminToken, companyA, ana).expect(201);
    });

    it('HR de otra empresa: 403 FORBIDDEN y no se encola nada', async () => {
      const response = await forceEmployee(hrOtherCompanyToken, companyA, ana).expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(resetJobs()).toEqual([]);
    });

    it('HR por la ruta de otra empresa: 403 aunque el colaborador exista', async () => {
      await forceEmployee(hrToken, companyB, ana).expect(403);
    });

    it('sin sesión: 401', async () => {
      const response = await forceEmployee(null, companyA, ana).expect(401);

      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('colaborador de otra empresa o inexistente: 404 EMPLOYEE_NOT_FOUND, con el mismo cuerpo', async () => {
      const otherEmployee = await hire(
        companyB,
        'pedro@aps.cl',
        '00000000-0000-4000-8000-00000000b001',
      );

      const foreign = await forceEmployee(hrToken, companyA, otherEmployee).expect(404);
      const missing = await forceEmployee(hrToken, companyA, NO_EMPLOYEE).expect(404);

      expect(foreign.body.code).toBe('EMPLOYEE_NOT_FOUND');
      expect(missing.body).toEqual(foreign.body);
    });

    it('colaborador sin cuenta: 404 USER_NOT_FOUND', async () => {
      const luis = await hire(
        companyA,
        'luis@aps.cl',
        '00000000-0000-4000-8000-00000000a002',
        'PEXL900215MDFRPR07',
      );

      const response = await forceEmployee(hrToken, companyA, luis).expect(404);

      expect(response.body.code).toBe('USER_NOT_FOUND');
      expect(resetJobs()).toEqual([]);
    });

    it('cuenta deshabilitada: 422 USER_DISABLED', async () => {
      const user = await userRepository().findByEmployeeId(ana);
      user?.disable(new Date());

      const response = await forceEmployee(hrToken, companyA, ana).expect(422);

      expect(response.body.code).toBe('USER_DISABLED');
      expect(resetJobs()).toEqual([]);
    });

    it('params inválidos de alguien autorizado: 400 VALIDATION_ERROR', async () => {
      const response = await forceEmployee(hrToken, companyA, 'no-es-uuid').expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /users/:userId/password-reset', () => {
    async function anaUserId(): Promise<string> {
      const user = await userRepository().findByEmployeeId(ana);
      if (!user) throw new Error('fixture: usuario de Ana no encontrado');
      return user.id;
    }

    it('Admin holding: 201 con id, correo y expiresAt, y encola el correo sensible', async () => {
      const response = await forceUser(adminToken, await anaUserId()).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        email: 'ana@aps.cl',
        expiresAt: expect.any(String),
      });
      expect(resetJobs()[0]?.options).toEqual({ sensitive: true });
      expect(resetJobs()[0]?.data).toMatchObject({ forcedByStaff: true });
    });

    it('también a un usuario externo (sin colaborador)', async () => {
      await as(adminToken).post('/invitations').send({ email: 'contador@externo.com' }).expect(201);
      const link = (
        jobQueue()
          .jobs.filter((job) => job.name === SEND_INVITATION_EMAIL)
          .at(-1)?.data as {
          link: string;
        }
      ).link;
      await request(app)
        .post(`${API_PREFIX}/auth/activate`)
        .send({ token: new URL(link).searchParams.get('token'), password: PASSWORD })
        .expect(204);
      const session = await login('contador@externo.com', PASSWORD).expect(200);

      const response = await forceUser(adminToken, session.body.user.id as string).expect(201);

      expect(response.body.email).toBe('contador@externo.com');
    });

    it('HR: 403 FORBIDDEN (aunque sea de la empresa del colaborador) y no se encola nada', async () => {
      const response = await forceUser(hrToken, await anaUserId()).expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(resetJobs()).toEqual([]);
    });

    it('sin sesión: 401', async () => {
      await forceUser(null, await anaUserId()).expect(401);
    });

    it('usuario inexistente: 404 USER_NOT_FOUND', async () => {
      const response = await forceUser(adminToken, NO_USER).expect(404);

      expect(response.body.code).toBe('USER_NOT_FOUND');
    });

    it('usuario deshabilitado: 422 USER_DISABLED', async () => {
      const user = await userRepository().findByEmployeeId(ana);
      user?.disable(new Date());

      const response = await forceUser(adminToken, await anaUserId()).expect(422);

      expect(response.body.code).toBe('USER_DISABLED');
    });

    it('userId que no es uuid: 400 VALIDATION_ERROR', async () => {
      const response = await forceUser(adminToken, 'no-es-uuid').expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  // Requieren servicios externos que `pnpm check` no levanta (Valkey y SMTP/Mailpit).
  it.skip('NOT CONFIRMED: el correo de restablecimiento llega a Mailpit con el enlace /restablecer y el job no queda en Valkey (requiere SMTP y Valkey)', () =>
    undefined);
});
