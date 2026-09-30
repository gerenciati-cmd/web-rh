import { createEvent, Email, NationalId } from '@rrhh/domain';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { wireSubscriptions } from '@/container';
import { API_PREFIX, createApp } from '@/http/app';
import {
  EMPLOYEE_TERMINATED,
  Employee,
  type EmployeeId,
} from '@/modules/employees/domain/employee';
import type { InMemoryEmployeeRepository } from '@/modules/employees/infrastructure/in-memory/in-memory-employee.repository';
import { SEND_INVITATION_EMAIL } from '@/modules/identity/application/jobs/send-invitation-email.job';
import { Invitation } from '@/modules/identity/domain/invitation';
import type { InMemoryInvitationRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-invitation.repository';
import type { RecordingJobQueue } from '@/shared/testing/fakes';

import { buildTestContainer, signInAs } from './test-app';

/**
 * Invitación, activación y baja de accesos (plan 003): contrato -> `bindRoute` -> casos de uso ->
 * suscripción a `employees.employee.terminated`. Persistencia, cola y correo en memoria.
 */
const PASSWORD = 'contraseña-larga-y-valida';
const NO_EMPLOYEE = '00000000-0000-4000-8000-00000000dead';
const CURP = 'GOMA850101HQRRRN04';

describe('invitaciones — HTTP', () => {
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
  const invitationRepository = () =>
    container.cradle.invitationRepository as InMemoryInvitationRepository;

  async function createCompany(legalName: string, taxId: string): Promise<string> {
    const response = await as(adminToken)
      .post('/companies')
      .send({ legalName, taxId, country: 'MX' })
      .expect(201);
    return response.body.id as string;
  }

  async function hire(companyId: string, rawEmail: string, id: string): Promise<string> {
    const nationalId = NationalId.create('MX', CURP);
    const email = Email.create(rawEmail);
    if (!nationalId.ok) throw nationalId.error;
    if (!email.ok) throw email.error;
    const employee = Employee.hire({
      id: id as EmployeeId,
      companyId,
      nationalId: nationalId.value,
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

  /** Token en claro del último correo encolado (lo único que lo contiene). */
  function lastToken(): string {
    const jobs = jobQueue().jobs.filter((job) => job.name === SEND_INVITATION_EMAIL);
    const link = (jobs.at(-1)?.data as { link: string } | undefined)?.link;
    if (!link) throw new Error('no se encoló ningún correo de invitación');
    return new URL(link).searchParams.get('token') ?? '';
  }

  const invite = (token: string | null, companyId: string, employeeId: string, body = {}) =>
    as(token).post(`/companies/${companyId}/employees/${employeeId}/invitations`).send(body);

  const activate = (body: object) => request(app).post(`${API_PREFIX}/auth/activate`).send(body);

  const login = (email: string, password = PASSWORD) =>
    request(app).post(`${API_PREFIX}/auth/login`).send({ email, password, client: 'mobile' });

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    companyA = await createCompany('Alfa SA de CV', 'EKU9003173C9');
    companyB = await createCompany('Beta SA de CV', 'AAA010101AAA');
    hrToken = await signInAs(container, { role: 'HR', companyId: companyA });
    hrOtherCompanyToken = await signInAs(container, { role: 'HR', companyId: companyB });
    ana = await hire(companyA, 'ana@aps.cl', '00000000-0000-4000-8000-00000000a001');
  });

  describe('POST /companies/:companyId/employees/:employeeId/invitations', () => {
    it('HR de la empresa: 201 con id, correo de la ficha y expiresAt; encola el correo', async () => {
      const response = await invite(hrToken, companyA, ana).expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        email: 'ana@aps.cl',
        expiresAt: expect.any(String),
      });
      expect(jobQueue().jobs).toHaveLength(1);
      expect(jobQueue().jobs[0]?.options).toEqual({ sensitive: true });
    });

    it('la respuesta nunca incluye el token ni su hash', async () => {
      const response = await invite(hrToken, companyA, ana).expect(201);

      const raw = JSON.stringify(response.body);
      expect(raw).not.toContain(lastToken());
      expect(Object.keys(response.body as object).sort()).toEqual(['email', 'expiresAt', 'id']);
    });

    it('con correo editado: ese es el correo de la invitación', async () => {
      const response = await invite(hrToken, companyA, ana, { email: 'ana.nueva@aps.cl' }).expect(
        201,
      );

      expect(response.body.email).toBe('ana.nueva@aps.cl');
      expect((jobQueue().jobs[0]?.data as { to: string }).to).toBe('ana.nueva@aps.cl');
    });

    it('Admin holding también puede invitar a un colaborador de cualquier empresa', async () => {
      await invite(adminToken, companyA, ana).expect(201);
    });

    it('HR de otra empresa: 403 FORBIDDEN', async () => {
      const response = await invite(hrOtherCompanyToken, companyA, ana).expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(jobQueue().jobs).toEqual([]);
    });

    it('HR invitando por la ruta de otra empresa: 403 aunque el colaborador exista', async () => {
      await invite(hrToken, companyB, ana).expect(403);
    });

    it('sin sesión: 401', async () => {
      const response = await invite(null, companyA, ana).expect(401);

      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('usuario con sesión pero sin roles: 403', async () => {
      const { registerUser, logIn } = container.cradle;
      const registered = await registerUser.execute({
        email: 'sin-rol@aps.cl',
        password: PASSWORD,
      });
      if (!registered.ok) throw registered.error;
      const session = await logIn.execute({
        email: 'sin-rol@aps.cl',
        password: PASSWORD,
        client: 'mobile',
        ip: null,
        userAgent: null,
      });
      if (!session.ok) throw session.error;

      await invite(session.value.token, companyA, ana).expect(403);
    });

    it('colaborador de otra empresa o inexistente: 404 EMPLOYEE_NOT_FOUND, con el mismo cuerpo', async () => {
      const otherEmployee = await hire(
        companyB,
        'pedro@aps.cl',
        '00000000-0000-4000-8000-00000000b001',
      );

      const foreign = await invite(hrToken, companyA, otherEmployee).expect(404);
      const missing = await invite(hrToken, companyA, NO_EMPLOYEE).expect(404);

      expect(foreign.body.code).toBe('EMPLOYEE_NOT_FOUND');
      expect(missing.body).toEqual(foreign.body);
    });

    it('colaborador desvinculado: 422 EMPLOYEE_INACTIVE', async () => {
      const employee = await employeeRepository().findById(ana as EmployeeId);
      const terminated = employee?.terminate(new Date('2026-01-20'), new Date('2026-01-20'));
      expect(terminated?.ok).toBe(true);

      const response = await invite(hrToken, companyA, ana).expect(422);

      expect(response.body.code).toBe('EMPLOYEE_INACTIVE');
    });

    it('colaborador que ya tiene cuenta: 409 EMPLOYEE_ALREADY_HAS_ACCESS', async () => {
      await invite(hrToken, companyA, ana).expect(201);
      await activate({ token: lastToken(), password: PASSWORD }).expect(204);

      const response = await invite(hrToken, companyA, ana).expect(409);

      expect(response.body.code).toBe('EMPLOYEE_ALREADY_HAS_ACCESS');
    });

    it('correo ya registrado por otra cuenta: 409 EMAIL_ALREADY_REGISTERED', async () => {
      const taken = await container.cradle.registerUser.execute({
        email: 'ocupado@aps.cl',
        password: PASSWORD,
      });
      if (!taken.ok) throw taken.error;

      const response = await invite(hrToken, companyA, ana, { email: 'ocupado@aps.cl' }).expect(
        409,
      );

      expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('params o body inválidos de alguien autorizado: 400 VALIDATION_ERROR', async () => {
      const badBody = await invite(hrToken, companyA, ana, { email: 'no-es-correo' }).expect(400);
      const badParam = await invite(hrToken, companyA, 'no-es-uuid').expect(400);

      expect(badBody.body.code).toBe('VALIDATION_ERROR');
      expect(badParam.body.code).toBe('VALIDATION_ERROR');
    });

    it('invitar de nuevo reemplaza a la anterior: el token viejo ya no activa', async () => {
      await invite(hrToken, companyA, ana).expect(201);
      const oldToken = lastToken();
      await invite(hrToken, companyA, ana).expect(201);
      const newToken = lastToken();

      const old = await activate({ token: oldToken, password: PASSWORD }).expect(422);
      expect(old.body.code).toBe('INVITATION_NOT_VALID');
      await activate({ token: newToken, password: PASSWORD }).expect(204);
    });
  });

  describe('POST /invitations (externa)', () => {
    const body = { email: 'contador@externo.com' };

    it('Admin holding: 201 y encola el correo sensible', async () => {
      const response = await as(adminToken).post('/invitations').send(body).expect(201);

      expect(response.body).toMatchObject({ email: 'contador@externo.com' });
      expect(jobQueue().jobs[0]?.options).toEqual({ sensitive: true });
    });

    it('HR: 403 FORBIDDEN y no se encola nada', async () => {
      const response = await as(hrToken).post('/invitations').send(body).expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(jobQueue().jobs).toEqual([]);
    });

    it('sin sesión: 401', async () => {
      await as(null).post('/invitations').send(body).expect(401);
    });

    it('correo ya registrado: 409 EMAIL_ALREADY_REGISTERED', async () => {
      await container.cradle.registerUser.execute({
        email: 'contador@externo.com',
        password: PASSWORD,
      });

      const response = await as(adminToken).post('/invitations').send(body).expect(409);

      expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('Admin holding con body inválido: 400', async () => {
      await as(adminToken).post('/invitations').send({ email: 'x' }).expect(400);
    });
  });

  describe('POST /auth/activate', () => {
    it('invitación a colaborador: 204, luego el login funciona y /auth/me trae employeeId', async () => {
      await invite(hrToken, companyA, ana).expect(201);

      await activate({ token: lastToken(), password: PASSWORD }).expect(204);
      const session = await login('ana@aps.cl').expect(200);
      const me = await as(session.body.token as string)
        .get('/auth/me')
        .expect(200);

      expect(me.body).toMatchObject({ email: 'ana@aps.cl', employeeId: ana });
    });

    it('el usuario nuevo tiene exactamente una asignación EMPLOYEE activa con la empresa del colaborador', async () => {
      await invite(hrToken, companyA, ana).expect(201);
      await activate({ token: lastToken(), password: PASSWORD }).expect(204);
      const session = await login('ana@aps.cl').expect(200);
      const userId = session.body.user.id as string;

      const response = await as(adminToken).get(`/users/${userId}/role-assignments`).expect(200);

      expect(response.body).toEqual([
        expect.objectContaining({ role: 'EMPLOYEE', companyId: companyA }),
      ]);
    });

    it('la activación no abre sesión: sin cookie ni token en la respuesta', async () => {
      await invite(hrToken, companyA, ana).expect(201);

      const response = await activate({ token: lastToken(), password: PASSWORD }).expect(204);

      expect(response.headers['set-cookie']).toBeUndefined();
      expect(response.text).toBe('');
    });

    it('la cuenta EMPLOYEE no concede permisos: sigue sin poder listar colaboradores (403)', async () => {
      await invite(hrToken, companyA, ana).expect(201);
      await activate({ token: lastToken(), password: PASSWORD }).expect(204);
      const session = await login('ana@aps.cl').expect(200);

      await as(session.body.token as string)
        .get(`/companies/${companyA}/employees`)
        .expect(403);
    });

    it('invitación externa: usuario sin colaborador (employeeId null) y sin rol', async () => {
      await as(adminToken).post('/invitations').send({ email: 'contador@externo.com' }).expect(201);

      await activate({ token: lastToken(), password: PASSWORD }).expect(204);
      const session = await login('contador@externo.com').expect(200);
      const token = session.body.token as string;
      const me = await as(token).get('/auth/me').expect(200);
      const assignments = await as(adminToken)
        .get(`/users/${me.body.id as string}/role-assignments`)
        .expect(200);

      expect(me.body.employeeId).toBeNull();
      expect(assignments.body).toEqual([]);
    });

    it('segundo uso del mismo token: 422 INVITATION_NOT_VALID', async () => {
      await invite(hrToken, companyA, ana).expect(201);
      const token = lastToken();
      await activate({ token, password: PASSWORD }).expect(204);

      const response = await activate({ token, password: PASSWORD }).expect(422);

      expect(response.body.code).toBe('INVITATION_NOT_VALID');
    });

    it('token desconocido, usado y reemplazado: mismo cuerpo 422', async () => {
      await invite(hrToken, companyA, ana).expect(201);
      const superseded = lastToken();
      await invite(hrToken, companyA, ana).expect(201);
      const used = lastToken();
      await activate({ token: used, password: PASSWORD }).expect(204);

      const bodies = await Promise.all(
        ['token-inventado', used, superseded].map(async (token) => {
          const response = await activate({ token, password: PASSWORD }).expect(422);
          return response.body as unknown;
        }),
      );

      expect(bodies[1]).toEqual(bodies[0]);
      expect(bodies[2]).toEqual(bodies[0]);
      expect(bodies[0]).toMatchObject({ code: 'INVITATION_NOT_VALID' });
    });

    it('token expirado: 422 INVITATION_NOT_VALID', async () => {
      await invite(hrToken, companyA, ana).expect(201);
      const token = lastToken();
      // Sin tocar el reloj del contenedor: se adelanta el vencimiento de la fila guardada.
      const [stored] = [...invitationRepository().invitations.values()];
      if (!stored) throw new Error('fixture: invitación no encontrada');
      invitationRepository().invitations.set(
        stored.id,
        Invitation.restore(stored.id, {
          ...stored.snapshot,
          expiresAt: new Date('2000-01-01T00:00:00Z'),
        }),
      );

      const response = await activate({ token, password: PASSWORD }).expect(422);

      expect(response.body.code).toBe('INVITATION_NOT_VALID');
    });

    it('contraseña débil: 422 WEAK_PASSWORD y el token sigue sirviendo', async () => {
      await invite(hrToken, companyA, ana).expect(201);
      const token = lastToken();

      const weak = await activate({ token, password: 'corta' }).expect(422);

      expect(weak.body.code).toBe('WEAK_PASSWORD');
      await activate({ token, password: PASSWORD }).expect(204);
    });

    it('body inválido (sin token): 400 VALIDATION_ERROR', async () => {
      const response = await activate({ password: PASSWORD }).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('no requiere sesión: es pública', async () => {
      const response = await activate({ token: 'x', password: PASSWORD });

      expect(response.status).toBe(422);
    });
  });

  describe('baja del colaborador (employees.employee.terminated)', () => {
    beforeEach(() => {
      wireSubscriptions(container);
    });

    async function terminate(employeeId: string): Promise<void> {
      const employee = await employeeRepository().findById(employeeId as EmployeeId);
      if (!employee) throw new Error('fixture: colaborador no encontrado');
      const result = employee.terminate(new Date('2026-02-01'), new Date('2026-02-01'));
      if (!result.ok) throw result.error;
      await container.cradle.eventBus.publish(employee.pullEvents());
    }

    async function activatedSession(): Promise<string> {
      await invite(hrToken, companyA, ana).expect(201);
      await activate({ token: lastToken(), password: PASSWORD }).expect(204);
      const session = await login('ana@aps.cl').expect(200);
      return session.body.token as string;
    }

    it('la sesión abierta recibe 401 en la siguiente petición', async () => {
      const token = await activatedSession();
      await as(token).get('/auth/me').expect(200);

      await terminate(ana);

      const response = await as(token).get('/auth/me').expect(401);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('ya no puede iniciar sesión, con el mismo error que una contraseña incorrecta', async () => {
      await activatedSession();
      await terminate(ana);

      const disabled = await login('ana@aps.cl').expect(401);
      const wrong = await login('ana@aps.cl', 'otra-contraseña-larga-xx').expect(401);

      expect(disabled.body).toEqual(wrong.body);
      expect(disabled.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('el usuario queda DISABLED (no se borra) en el listado de usuarios', async () => {
      await activatedSession();
      await terminate(ana);

      const users = await as(adminToken).get('/users?search=ana@aps.cl').expect(200);

      expect(users.body.items).toEqual([expect.objectContaining({ status: 'DISABLED' })]);
    });

    it('la baja de un colaborador sin cuenta no afecta a las cuentas de otros', async () => {
      const pedro = await hire(companyB, 'pedro@aps.cl', '00000000-0000-4000-8000-00000000b002');
      const token = await activatedSession();

      await terminate(pedro);

      await as(token).get('/auth/me').expect(200);
    });

    it('un evento con payload desconocido se ignora (el bus lo registra) y no afecta a nadie', async () => {
      const token = await activatedSession();

      await expect(
        container.cradle.eventBus.publish([
          createEvent(EMPLOYEE_TERMINATED, { otraCosa: true }, new Date()),
        ]),
      ).resolves.toBeUndefined();

      await as(token).get('/auth/me').expect(200);
    });
  });

  // Requieren servicios externos que `pnpm check` no levanta (Valkey y SMTP/Mailpit).
  it.skip('NOT CONFIRMED: con `sensitive` el adaptador BullMQ usa removeOnComplete/removeOnFail = true (requiere Valkey)', () =>
    undefined);
  it.skip('NOT CONFIRMED: SmtpEmailSender entrega el correo en Mailpit con el enlace de activación (requiere SMTP)', () =>
    undefined);
});
