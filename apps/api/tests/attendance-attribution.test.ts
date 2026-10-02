import { Email, NationalId } from '@rrhh/domain';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { Employee, type EmployeeId } from '@/modules/employees/domain/employee';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/**
 * Atribución de marcaciones por RFC (plan attendance-marcaciones/002): el PIN del checador es el
 * RFC del colaborador. Equipo registrado por la API, empuje por /iclock, colaboradores dados de
 * alta por la API, todo sobre persistencia en memoria.
 */
const RFC_ANA = 'GOMA850101AB1';
const device = { serialNumber: 'TESTSN001', name: 'Entrada', timeZone: 'America/Cancun' };

const ana = {
  nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
  rfc: RFC_ANA,
  firstName: 'Ana',
  lastName: 'Rojas',
  email: 'ana@aps.example',
  hireDate: '2026-01-10',
};
const dominican = {
  nationalId: { country: 'DO', number: '00113918205' },
  firstName: 'Luis',
  lastName: 'Araya',
  email: 'luis@aps.example',
  hireDate: '2026-01-10',
};

/** Línea ATTLOG: PIN, hora local, status, verifyMode y el relleno del formato del equipo. */
const attlog = (pin: string, time: string) => `${pin}\t${time}\t0\t1\t0\t0\t0\t0\t0\t0\t\n`;

interface PunchBody {
  pin: string;
  employee: { id: string; fullName: string; companyId: string } | null;
}

describe('atribución de marcaciones por RFC (HTTP)', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrAToken: string;
  let hrBToken: string;
  let noRoleToken: string;
  let companyA: string;
  let companyB: string;
  let siteId: string;

  const call = (method: 'get' | 'post' | 'put', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };
  const punches = async (token: string | null, query = '') =>
    call('get', `/attendance/punches${query}`, token);
  const itemsOf = (response: request.Response) => (response.body as { items: PunchBody[] }).items;

  function push(body: string) {
    return request(app)
      .post(`/iclock/cdata?SN=${device.serialNumber}&table=ATTLOG`)
      .set('Content-Type', 'text/plain')
      .send(body);
  }
  async function createCompany(legalName: string, taxId: string): Promise<string> {
    const response = await call('post', '/companies', adminToken)
      .send({ legalName, taxId, country: 'MX' })
      .expect(201);
    return response.body.id as string;
  }
  async function hire(companyId: string, body: object): Promise<string> {
    await call('post', `/companies/${companyId}/employees`, adminToken)
      .send({ siteId, ...body })
      .expect(201);
    const list = await call('get', `/companies/${companyId}/employees`, adminToken).expect(200);
    const rows = list.body.items as { id: string; email: string }[];
    const row = rows.find((r) => r.email === (body as { email: string }).email);
    if (!row) throw new Error('colaborador no listado');
    return row.id;
  }

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    siteId = await createTestSite(container);
    companyA = await createCompany('Alfa SA de CV', 'EKU9003173C9');
    companyB = await createCompany('Beta SA de CV', 'AAA010101AAA');
    hrAToken = await signInAs(container, { role: 'HR', companyId: companyA });
    hrBToken = await signInAs(container, { role: 'HR', companyId: companyB });
    const { registerUser, logIn } = container.cradle;
    await registerUser.execute({
      email: 'sin-rol@example.com',
      password: 'contraseña-larga-y-valida',
    });
    const session = await logIn.execute({
      email: 'sin-rol@example.com',
      password: 'contraseña-larga-y-valida',
      client: 'mobile',
      ip: null,
      userAgent: null,
    });
    if (!session.ok) throw session.error;
    noRoleToken = session.value.token;
    await call('post', '/attendance/devices', adminToken).send(device).expect(201);
  });

  it('HOLDING_ADMIN lista ambas: la del RFC lleva employee, la del PIN "1" lleva null', async () => {
    const anaId = await hire(companyA, ana);
    await push(attlog(RFC_ANA, '2026-09-28 08:00:00') + attlog('1', '2026-09-28 09:00:00')).expect(
      200,
    );

    const response = await punches(adminToken);
    const items = itemsOf(response);

    expect(response.body.total).toBe(2);
    expect(items.find((i) => i.pin === RFC_ANA)?.employee).toEqual({
      id: anaId,
      fullName: 'Ana Rojas',
      companyId: companyA,
    });
    expect(items.find((i) => i.pin === '1')?.employee).toBeNull();
  });

  it('HR de la empresa A: 200 solo con la marcación del RFC; los filtros siguen aplicando', async () => {
    await hire(companyA, ana);
    await push(
      attlog(RFC_ANA, '2026-09-28 08:00:00') +
        attlog(RFC_ANA, '2026-09-28 12:00:00') +
        attlog('1', '2026-09-28 09:00:00'),
    ).expect(200);

    const all = await punches(hrAToken);
    const byPin = await punches(hrAToken, `?pin=${RFC_ANA}`);
    const byRange = await punches(
      hrAToken,
      '?from=2026-09-28T16:00:00.000Z&to=2026-09-28T18:00:00.000Z',
    );
    const otherPin = await punches(hrAToken, '?pin=1');

    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
    expect(itemsOf(all).every((i) => i.pin === RFC_ANA)).toBe(true);
    expect(byPin.body.total).toBe(2);
    expect(itemsOf(byRange).map((i) => i.pin)).toEqual([RFC_ANA]);
    expect(byRange.body.total).toBe(1);
    expect(otherPin.status).toBe(200);
    expect(otherPin.body.total).toBe(0);
  });

  it('HR de la empresa B (sin colaborador con ese RFC): 200 con página vacía', async () => {
    await hire(companyA, ana);
    await push(attlog(RFC_ANA, '2026-09-28 08:00:00')).expect(200);

    const response = await punches(hrBToken, '?page=1&pageSize=10');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [], total: 0, page: 1, pageSize: 10 });
  });

  it('HR de una empresa sin ningún RFC registrado: 200 vacío (colaborador sin RFC no aporta PIN)', async () => {
    await hire(companyB, dominican);
    await push(attlog('1', '2026-09-28 08:00:00')).expect(200);

    const response = await punches(hrBToken);

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(0);
  });

  it('una marcación anterior al RFC queda atribuida en cuanto se asigna con PUT .../rfc, sin reprocesar', async () => {
    // El alta por la API ya exige RFC: el colaborador anterior al campo se inserta como dato viejo.
    const nationalId = NationalId.create('MX', 'ROSA010305HQRDNLA3');
    const email = Email.create('legacy@aps.example');
    if (!nationalId.ok || !email.ok) throw new Error('fixture inválido');
    const id = '00000000-0000-4000-8000-0000000000a1' as EmployeeId;
    await container.cradle.employeeRepository.save(
      Employee.restore(id, {
        companyId: companyA,
        nationalId: nationalId.value,
        rfc: null,
        siteId: null,
        firstName: 'Luis',
        lastName: 'Antiguo',
        email: email.value,
        positionTitle: null,
        hireDate: new Date('2025-01-01T00:00:00Z'),
        status: 'ACTIVE',
      }),
    );
    await push(attlog('ROSA010305AB1', '2026-09-28 08:00:00')).expect(200);
    expect(itemsOf(await punches(adminToken))[0]?.employee).toBeNull();

    await call('put', `/companies/${companyA}/employees/${id}/rfc`, hrAToken)
      .send({ rfc: 'ROSA010305AB1' })
      .expect(204);

    expect(itemsOf(await punches(adminToken))[0]?.employee).toEqual({
      id,
      fullName: 'Luis Antiguo',
      companyId: companyA,
    });
  });

  it('HR corrige el RFC de un colaborador: la marcación previa con ese PIN se atribuye al instante', async () => {
    const anaId = await hire(companyA, { ...ana, rfc: 'GOMA850101AB9' });
    await push(attlog(RFC_ANA, '2026-09-28 08:00:00')).expect(200);
    expect(itemsOf(await punches(adminToken))[0]?.employee).toBeNull();
    expect((await punches(hrAToken)).body.total).toBe(0);

    await call('put', `/companies/${companyA}/employees/${anaId}/rfc`, hrAToken)
      .send({ rfc: RFC_ANA })
      .expect(204);

    const asAdmin = itemsOf(await punches(adminToken));
    expect(asAdmin[0]?.employee).toMatchObject({ id: anaId, companyId: companyA });
    expect((await punches(hrAToken)).body.total).toBe(1);
  });

  it('un colaborador desvinculado conserva sus marcaciones atribuidas', async () => {
    const anaId = await hire(companyA, ana);
    await push(attlog(RFC_ANA, '2026-09-28 08:00:00')).expect(200);
    const { employeeRepository } = container.cradle;
    const found = await employeeRepository.findById(anaId as EmployeeId);
    if (!found) throw new Error('colaborador no encontrado');
    const terminated = found.terminate(new Date('2026-09-29T00:00:00Z'), new Date());
    if (!terminated.ok) throw terminated.error;
    await employeeRepository.save(found);

    const asAdmin = itemsOf(await punches(adminToken));
    const asHr = await punches(hrAToken);

    expect(asAdmin[0]?.employee).toMatchObject({ id: anaId, fullName: 'Ana Rojas' });
    expect(asHr.body.total).toBe(1);
  });

  it('sin sesión: 401 AUTHENTICATION_REQUIRED; sin rol: 403 FORBIDDEN', async () => {
    const anonymous = await punches(null);
    const noRole = await punches(noRoleToken);

    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('AUTHENTICATION_REQUIRED');
    expect(noRole.status).toBe(403);
    expect(noRole.body.code).toBe('FORBIDDEN');
  });

  it.skip('NOT CONFIRMED: persona enrolada con su RFC en un SenseFace 2A real; requiere el equipo físico (criterio 6 del plan)', () => {
    // Sin dispositivo no hay forma de ejercitarlo localmente.
  });
});
