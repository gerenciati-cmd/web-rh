import { Email, NationalId, PersonalRfc } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { Employee, type EmployeeId } from '@/modules/employees/domain/employee';
import { EmployeeAlreadyExistsError } from '@/modules/employees/domain/errors';
import { PrismaEmployeeQueries } from '@/modules/employees/infrastructure/prisma-employee.queries';
import { PrismaEmployeeRepository } from '@/modules/employees/infrastructure/prisma-employee.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['employees.employees']);
const repository = new PrismaEmployeeRepository({ database });
const queries = new PrismaEmployeeQueries({ database });
const ids = new SequentialIdGenerator();

const COMPANY_A = '00000000-0000-4000-8000-00000000000a';
const COMPANY_B = '00000000-0000-4000-8000-00000000000b';
const NOW = new Date('2026-01-15T12:00:00Z');
let rfcSequence = 0;

function employee(input: {
  companyId?: string;
  curp: string;
  firstName: string;
  lastName: string;
  hireDate?: string;
  /** RFC explícito; si se omite se genera uno distinto por alta. */
  rfc?: string;
  /** Sede explícita; si se omite se usa una fija (sin FK: la sede vive en organization). */
  siteId?: string;
}): Employee {
  const nationalId = NationalId.create('MX', input.curp);
  const email = Email.create(`${input.firstName}.${input.lastName}@aps.cl`);
  // Homoclave distinta por alta: el RFC es único en el holding aunque el CURP se repita.
  rfcSequence += 1;
  const rfc = PersonalRfc.create(
    input.rfc ?? `${input.curp.slice(0, 10)}A${String(rfcSequence).padStart(2, '0')}`,
  );
  if (!nationalId.ok || !email.ok || !rfc.ok) throw new Error('fixture inválido');
  const hired = Employee.hire({
    id: ids.next() as EmployeeId,
    companyId: input.companyId ?? COMPANY_A,
    nationalId: nationalId.value,
    rfc: rfc.value,
    siteId: input.siteId ?? '019b1c2e-0000-7000-8000-000000000001',
    firstName: input.firstName,
    lastName: input.lastName,
    email: email.value,
    hireDate: new Date(`${input.hireDate ?? '2026-01-10'}T00:00:00Z`),
    now: NOW,
  });
  if (!hired.ok) throw hired.error;
  return hired.value;
}

describe('PrismaEmployeeRepository', () => {
  it('guarda y rehidrata sin correr la fecha de contratación (columna DATE)', async () => {
    const ana = employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' });
    await repository.add(ana);

    const found = await repository.findById(ana.id);

    expect(found?.snapshot.hireDate.toISOString()).toBe('2026-01-10T00:00:00.000Z');
    expect(found?.snapshot.nationalId.value).toBe('GOMA850101HQRRRN04');
    expect(found?.snapshot.status).toBe('ACTIVE');
  });

  it('persiste la desvinculación', async () => {
    const ana = employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' });
    await repository.add(ana);
    ana.terminate({ date: new Date('2026-01-12T00:00:00Z'), reason: 'VOLUNTARY_RESIGNATION' }, NOW);
    await repository.saveTermination(ana);

    expect((await repository.findById(ana.id))?.snapshot.status).toBe('TERMINATED');
  });

  it('existsInCompany está acotado a la empresa', async () => {
    await repository.add(
      employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' }),
    );
    const sameCurp = NationalId.create('MX', 'goma850101hqrrrn04');
    if (!sameCurp.ok) throw sameCurp.error;

    expect(await repository.existsInCompany(COMPANY_A, sameCurp.value)).toBe(true);
    expect(await repository.existsInCompany(COMPANY_B, sameCurp.value)).toBe(false);
  });

  it('la misma CURP puede existir en otra empresa del holding', async () => {
    await repository.add(
      employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' }),
    );

    await expect(
      repository.add(
        employee({
          companyId: COMPANY_B,
          curp: 'GOMA850101HQRRRN04',
          firstName: 'Ana',
          lastName: 'Rojas',
        }),
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
  });

  it('traduce la violación del índice único (carrera) al conflicto de dominio', async () => {
    await repository.add(
      employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' }),
    );

    await expect(
      repository.add(
        employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Otra', lastName: 'Persona' }),
      ),
    ).resolves.toMatchObject({ ok: false, error: expect.any(EmployeeAlreadyExistsError) });
  });
});

it('dos saves concurrentes conservan una fila por empresa y documento', async () => {
  const results = await Promise.all([
    repository.add(employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Fixture', lastName: 'Uno' })),
    repository.add(employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Fixture', lastName: 'Dos' })),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok).map((result) => result.error.code)).toEqual([
    'EMPLOYEE_ALREADY_EXISTS',
  ]);
  expect((await queries.listDirectory({ companyId: COMPANY_A, page: 1, pageSize: 20 })).total).toBe(
    1,
  );
});

/** Fila anterior al campo RFC: se rehidrata con rfc nulo (el alta de México ya lo exige). */
function withoutRfc(source: Employee): Employee {
  return Employee.restore(source.id, { ...source.snapshot, rfc: null });
}

describe('RFC en PrismaEmployeeRepository', () => {
  const ANA = { curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' };
  const PEDRO = { curp: 'PEXL900215MDFRPR07', firstName: 'Pedro', lastName: 'Soto' };

  it('guarda y rehidrata el RFC', async () => {
    const ana = employee({ ...ANA, rfc: 'GOMA850101AB1' });
    await repository.add(ana);

    expect((await repository.findById(ana.id))?.snapshot.rfc?.value).toBe('GOMA850101AB1');
  });

  it('permite varias filas sin RFC (NULL no choca con el índice único)', async () => {
    const results = await Promise.all([
      repository.add(withoutRfc(employee(ANA))),
      repository.add(withoutRfc(employee(PEDRO))),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      (await queries.listDirectory({ companyId: COMPANY_A, page: 1, pageSize: 20 })).items.map(
        (item) => item.rfc,
      ),
    ).toEqual([null, null]);
  });

  it('rechaza el mismo RFC en otra empresa del holding con EMPLOYEE_RFC_ALREADY_REGISTERED', async () => {
    await repository.add(employee({ ...ANA, rfc: 'GOMA850101AB1' }));

    const result = await repository.add(
      employee({ ...PEDRO, companyId: COMPANY_B, rfc: 'GOMA850101AB1' }),
    );

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_RFC_ALREADY_REGISTERED');
  });

  it('con CURP y RFC repetidos en la misma empresa reporta el CURP (EMPLOYEE_ALREADY_EXISTS)', async () => {
    await repository.add(employee({ ...ANA, rfc: 'GOMA850101AB1' }));

    const result = await repository.add(
      employee({ ...ANA, firstName: 'Otra', rfc: 'GOMA850101AB1' }),
    );

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_EXISTS');
  });

  it('con solo el CURP repetido y otro RFC reporta EMPLOYEE_ALREADY_EXISTS', async () => {
    await repository.add(employee({ ...ANA, rfc: 'GOMA850101AB1' }));

    const result = await repository.add(
      employee({ ...ANA, firstName: 'Otra', rfc: 'GOMA850101AB2' }),
    );

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_EXISTS');
  });

  it('actualiza el RFC de una fila existente sin RFC', async () => {
    const ana = withoutRfc(employee(ANA));
    await repository.add(ana);
    const found = await repository.findById(ana.id);
    const rfc = PersonalRfc.create('GOMA850101AB1');
    if (!found || !rfc.ok) throw new Error('fixture inválido');

    found.assignRfc(rfc.value, NOW);
    expect((await repository.saveRfc(found)).ok).toBe(true);

    expect((await repository.findById(ana.id))?.snapshot.rfc?.value).toBe('GOMA850101AB1');
  });

  it('volver a guardar al dueño de un RFC no choca consigo mismo', async () => {
    const ana = employee({ ...ANA, rfc: 'GOMA850101AB1' });
    await repository.add(ana);

    expect((await repository.saveRfc(ana)).ok).toBe(true);
  });

  it('asignar el RFC de otro colaborador falla con EMPLOYEE_RFC_ALREADY_REGISTERED y no lo cambia', async () => {
    await repository.add(employee({ ...ANA, rfc: 'GOMA850101AB1' }));
    const pedro = withoutRfc(employee(PEDRO));
    await repository.add(pedro);
    const rfc = PersonalRfc.create('GOMA850101AB1');
    if (!rfc.ok) throw rfc.error;
    pedro.assignRfc(rfc.value, NOW);

    const result = await repository.saveRfc(pedro);

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_RFC_ALREADY_REGISTERED');
    expect((await repository.findById(pedro.id))?.snapshot.rfc).toBeNull();
  });

  it('existsByRfc encuentra el RFC y puede excluir al propio colaborador', async () => {
    const ana = employee({ ...ANA, rfc: 'GOMA850101AB1' });
    await repository.add(ana);
    const rfc = PersonalRfc.create('GOMA850101AB1');
    const free = PersonalRfc.create('GOMA850101AB9');
    if (!rfc.ok || !free.ok) throw new Error('fixture inválido');

    expect(await repository.existsByRfc(rfc.value)).toBe(true);
    expect(await repository.existsByRfc(rfc.value, ana.id)).toBe(false);
    expect(await repository.existsByRfc(free.value)).toBe(false);
  });
});

describe('RFC en PrismaEmployeeQueries', () => {
  const ANA = { curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' };
  const PEDRO = { curp: 'PEXL900215MDFRPR07', firstName: 'Pedro', lastName: 'Soto' };
  const LUIS = { curp: 'ROSA010305HQRDNLA3', firstName: 'Luis', lastName: 'Araya' };

  it('listDirectory devuelve el RFC o null', async () => {
    await repository.add(employee({ ...ANA, rfc: 'GOMA850101AB1' }));
    await repository.add(withoutRfc(employee(PEDRO)));

    const result = await queries.listDirectory({ companyId: COMPANY_A, page: 1, pageSize: 20 });

    expect(result.items.map((item) => [item.fullName, item.rfc])).toEqual([
      ['Ana Rojas', 'GOMA850101AB1'],
      ['Pedro Soto', null],
    ]);
  });

  it('findByRfcs devuelve a los dueños de todas las empresas e ignora los RFC que nadie tiene', async () => {
    const ana = employee({ ...ANA, rfc: 'GOMA850101AB1' });
    const luis = employee({ ...LUIS, companyId: COMPANY_B, rfc: 'ROSA010305AB1' });
    await repository.add(ana);
    await repository.add(luis);
    await repository.add(employee({ ...PEDRO, rfc: 'PEXL900215AB2' }));

    const owners = await queries.findByRfcs(['GOMA850101AB1', 'ROSA010305AB1', 'ZZZZ000101AAA']);

    expect(owners).toHaveLength(2);
    expect(owners).toContainEqual({
      id: ana.id,
      companyId: COMPANY_A,
      fullName: 'Ana Rojas',
      rfc: 'GOMA850101AB1',
      active: true,
    });
    expect(owners).toContainEqual({
      id: luis.id,
      companyId: COMPANY_B,
      fullName: 'Luis Araya',
      rfc: 'ROSA010305AB1',
      active: true,
    });
  });

  it('findByRfcs marca active=false al colaborador desvinculado', async () => {
    const ana = employee({ ...ANA, rfc: 'GOMA850101AB1' });
    await repository.add(ana);
    ana.terminate({ date: new Date('2026-01-12T00:00:00Z'), reason: 'VOLUNTARY_RESIGNATION' }, NOW);
    await repository.saveTermination(ana);

    expect(await queries.findByRfcs(['GOMA850101AB1'])).toMatchObject([{ active: false }]);
  });

  it('findByRfcs sin RFC devuelve []', async () => {
    await repository.add(employee({ ...ANA, rfc: 'GOMA850101AB1' }));

    expect(await queries.findByRfcs([])).toEqual([]);
  });

  it('rfcsInCompanies solo trae los RFC de esas empresas e ignora a quienes no tienen RFC', async () => {
    await repository.add(employee({ ...ANA, rfc: 'GOMA850101AB1' }));
    await repository.add(withoutRfc(employee(PEDRO)));
    await repository.add(employee({ ...LUIS, companyId: COMPANY_B, rfc: 'ROSA010305AB1' }));

    expect(await queries.rfcsInCompanies([COMPANY_A])).toEqual(['GOMA850101AB1']);
    expect((await queries.rfcsInCompanies([COMPANY_A, COMPANY_B])).sort()).toEqual([
      'GOMA850101AB1',
      'ROSA010305AB1',
    ]);
  });

  it('rfcsInCompanies sin empresas devuelve []', async () => {
    await repository.add(employee({ ...ANA, rfc: 'GOMA850101AB1' }));

    expect(await queries.rfcsInCompanies([])).toEqual([]);
  });
});

describe('Sede en PrismaEmployeeRepository y PrismaEmployeeQueries', () => {
  const SITE_1 = '019b1c2e-0000-7000-8000-000000000001';
  const SITE_2 = '019b1c2e-0000-7000-8000-000000000002';
  const ANA = { curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' };
  const PEDRO = { curp: 'PEXL900215MDFRPR07', firstName: 'Pedro', lastName: 'Soto' };
  const LUIS = { curp: 'ROSA010305HQRDNLA3', firstName: 'Luis', lastName: 'Araya' };
  const page = { page: 1, pageSize: 20 };

  /** Fila anterior al campo sede: se rehidrata con siteId nulo. */
  const withoutSite = (source: Employee) =>
    Employee.restore(source.id, { ...source.snapshot, siteId: null });

  it('guarda y rehidrata la sede', async () => {
    const ana = employee({ ...ANA, siteId: SITE_2 });
    await repository.add(ana);

    expect((await repository.findById(ana.id))?.snapshot.siteId).toBe(SITE_2);
  });

  it('persiste el cambio de sede de una fila existente', async () => {
    const ana = employee(ANA);
    await repository.add(ana);
    const found = await repository.findById(ana.id);
    if (!found) throw new Error('fixture inválido');

    found.assignSite(SITE_2, NOW);
    expect((await repository.saveSite(found)).ok).toBe(true);

    expect((await repository.findById(ana.id))?.snapshot.siteId).toBe(SITE_2);
  });

  it('una fila sin sede se rehidrata con siteId null, se lista con siteId null y puede recibir sede', async () => {
    const ana = withoutSite(employee(ANA));
    await repository.add(ana);

    expect((await repository.findById(ana.id))?.snapshot.siteId).toBeNull();
    expect((await queries.listDirectory({ companyId: COMPANY_A, ...page })).items[0]?.siteId).toBe(
      null,
    );

    const found = await repository.findById(ana.id);
    if (!found) throw new Error('fixture inválido');
    found.assignSite(SITE_1, NOW);
    await repository.saveSite(found);
    expect((await repository.findById(ana.id))?.snapshot.siteId).toBe(SITE_1);
  });

  it('listDirectory devuelve el siteId de cada colaborador', async () => {
    await repository.add(employee({ ...ANA, siteId: SITE_1 }));
    await repository.add(withoutSite(employee(PEDRO)));

    const result = await queries.listDirectory({ companyId: COMPANY_A, ...page });

    expect(result.items.map((item) => [item.fullName, item.siteId])).toEqual([
      ['Ana Rojas', SITE_1],
      ['Pedro Soto', null],
    ]);
  });

  it('listActiveOnSite solo trae ACTIVE de esa sede, de todas las empresas, ordenados por apellido, nombre e id', async () => {
    const zoe = employee({ ...LUIS, firstName: 'Zoe' });
    const ana = employee({ ...ANA, siteId: SITE_1 });
    const luis = employee({ ...LUIS, companyId: COMPANY_B, siteId: SITE_1 });
    const pedro = employee({ ...PEDRO, siteId: SITE_1 });
    const otherSite = employee({
      ...PEDRO,
      companyId: COMPANY_B,
      firstName: 'Marco',
      lastName: 'Cruz',
      siteId: SITE_2,
    });
    await repository.add(ana);
    await repository.add(luis);
    await repository.add(pedro);
    await repository.add(otherSite);
    await repository.add(withoutSite(zoe));
    pedro.terminate(
      { date: new Date('2026-01-12T00:00:00Z'), reason: 'VOLUNTARY_RESIGNATION' },
      NOW,
    );
    await repository.saveTermination(pedro);

    const members = await queries.listActiveOnSite(SITE_1);

    expect(members.map((m) => m.fullName)).toEqual(['Luis Araya', 'Ana Rojas']);
    expect(members).toContainEqual({
      id: ana.id,
      companyId: COMPANY_A,
      fullName: 'Ana Rojas',
      rfc: ana.snapshot.rfc?.value ?? null,
    });
    expect(members.find((m) => m.id === luis.id)?.companyId).toBe(COMPANY_B);
  });

  it('listActiveOnSite desempata por nombre cuando comparten apellido', async () => {
    await repository.add(employee({ ...ANA, firstName: 'Beto', lastName: 'Rojas' }));
    await repository.add(employee({ ...PEDRO, firstName: 'Alma', lastName: 'Rojas' }));

    expect((await queries.listActiveOnSite(SITE_1)).map((m) => m.fullName)).toEqual([
      'Alma Rojas',
      'Beto Rojas',
    ]);
  });

  it('listActiveOnSite devuelve rfc null para quien no tiene RFC', async () => {
    const pedro = employee(PEDRO);
    await repository.add(Employee.restore(pedro.id, { ...pedro.snapshot, rfc: null }));

    expect((await queries.listActiveOnSite(SITE_1))[0]?.rfc).toBeNull();
  });

  it('listActiveOnSite de una sede sin colaboradores devuelve []', async () => {
    await repository.add(employee(ANA));

    expect(await queries.listActiveOnSite(SITE_2)).toEqual([]);
  });
});

describe('PrismaEmployeeQueries.listDirectory', () => {
  async function seed() {
    const pedro = employee({ curp: 'PEXL900215MDFRPR07', firstName: 'Pedro', lastName: 'Soto' });
    await repository.add(
      employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' }),
    );
    await repository.add(pedro);
    await repository.add(
      employee({
        companyId: COMPANY_B,
        curp: 'ROSA010305HQRDNLA3',
        firstName: 'Luis',
        lastName: 'Araya',
      }),
    );
    pedro.terminate(
      { date: new Date('2026-01-12T00:00:00Z'), reason: 'VOLUNTARY_RESIGNATION' },
      NOW,
    );
    await repository.saveTermination(pedro);
  }

  const page = { page: 1, pageSize: 20 };

  it('solo devuelve colaboradores de la empresa pedida, ordenados por apellido', async () => {
    await seed();

    const result = await queries.listDirectory({ ...page, companyId: COMPANY_A });

    expect(result.total).toBe(2);
    expect(result.items.map((e) => e.fullName)).toEqual(['Ana Rojas', 'Pedro Soto']);
    expect(result.items[0]).toMatchObject({
      nationalId: 'GOMA850101HQRRRN04',
      hireDate: '2026-01-10',
    });
  });

  it('filtra por estado', async () => {
    await seed();

    const result = await queries.listDirectory({
      ...page,
      companyId: COMPANY_A,
      status: 'TERMINATED',
    });

    expect(result.items.map((e) => e.fullName)).toEqual(['Pedro Soto']);
  });

  it('busca sin distinguir mayúsculas por nombre y por CURP', async () => {
    await seed();

    const byName = await queries.listDirectory({ ...page, companyId: COMPANY_A, search: 'ROJ' });
    const byCurp = await queries.listDirectory({
      ...page,
      companyId: COMPANY_A,
      search: 'pexl900215',
    });

    expect(byName.items.map((e) => e.fullName)).toEqual(['Ana Rojas']);
    expect(byCurp.items.map((e) => e.fullName)).toEqual(['Pedro Soto']);
  });

  it('pagina y reporta el total del filtro', async () => {
    await seed();

    const result = await queries.listDirectory({ page: 2, pageSize: 1, companyId: COMPANY_A });

    expect(result.total).toBe(2);
    expect(result.items.map((e) => e.fullName)).toEqual(['Pedro Soto']);
  });
});

describe('Baja en PrismaEmployeeRepository y PrismaEmployeeQueries (employees-desvinculacion/001)', () => {
  const page = { page: 1, pageSize: 20 };

  it('guarda y rehidrata fecha (columna DATE, sin correrse) y motivo de la baja', async () => {
    const ana = employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' });
    await repository.add(ana);
    ana.terminate(
      { date: new Date('2026-01-12T00:00:00Z'), reason: 'DISMISSAL_WITHOUT_CAUSE' },
      NOW,
    );
    await repository.saveTermination(ana);

    const found = await repository.findById(ana.id);

    expect(found?.snapshot.status).toBe('TERMINATED');
    expect(found?.snapshot.termination).toEqual({
      date: new Date('2026-01-12T00:00:00.000Z'),
      reason: 'DISMISSAL_WITHOUT_CAUSE',
    });
  });

  it('un activo se rehidrata con termination null', async () => {
    const ana = employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' });
    await repository.add(ana);

    expect((await repository.findById(ana.id))?.snapshot.termination).toBeNull();
  });

  it('una fila TERMINATED sin fecha ni motivo (anterior al campo) se rehidrata con termination null', async () => {
    const ana = employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' });
    const { termination: _none, ...props } = ana.snapshot;
    await repository.add(Employee.restore(ana.id, { ...props, status: 'TERMINATED' }));

    const found = await repository.findById(ana.id);

    expect(found?.snapshot.status).toBe('TERMINATED');
    expect(found?.snapshot.termination).toBeNull();
  });

  it('listDirectory devuelve fecha y motivo del desvinculado, y null para el activo', async () => {
    const ana = employee({ curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' });
    const pedro = employee({ curp: 'PEXL900215MDFRPR07', firstName: 'Pedro', lastName: 'Soto' });
    await repository.add(ana);
    await repository.add(pedro);
    pedro.terminate({ date: new Date('2026-01-12T00:00:00Z'), reason: 'INCAPACITY' }, NOW);
    await repository.saveTermination(pedro);

    const result = await queries.listDirectory({ ...page, companyId: COMPANY_A });

    expect(result.items.map((e) => [e.fullName, e.terminationDate, e.terminationReason])).toEqual([
      ['Ana Rojas', null, null],
      ['Pedro Soto', '2026-01-12', 'INCAPACITY'],
    ]);
  });
});

describe('Escrituras dirigidas (employees-desvinculacion/002)', () => {
  const SITE_1 = '019b1c2e-0000-7000-8000-000000000001';
  const SITE_2 = '019b1c2e-0000-7000-8000-000000000002';
  const ANA = { curp: 'GOMA850101HQRRRN04', firstName: 'Ana', lastName: 'Rojas' };
  const TERMINATION = { date: new Date('2026-01-12T00:00:00Z'), reason: 'DEATH' } as const;

  const rfcOf = (raw: string) => {
    const rfc = PersonalRfc.create(raw);
    if (!rfc.ok) throw rfc.error;
    return rfc.value;
  };

  /** Dos lecturas de la misma fila: simulan dos peticiones que la cargaron a la vez. */
  async function twoReads() {
    const ana = employee({ ...ANA, rfc: 'GOMA850101AB1', siteId: SITE_1 });
    await repository.add(ana);
    const first = await repository.findById(ana.id);
    const second = await repository.findById(ana.id);
    if (!first || !second) throw new Error('fixture inválido');
    return { id: ana.id, first, second };
  }

  it('saveSite solo escribe la sede (un RFC cambiado en memoria no se guarda)', async () => {
    const { id, first } = await twoReads();
    first.assignRfc(rfcOf('GOMA850101AB9'), NOW);
    first.assignSite(SITE_2, NOW);

    expect((await repository.saveSite(first)).ok).toBe(true);

    const found = await repository.findById(id);
    expect(found?.snapshot.siteId).toBe(SITE_2);
    expect(found?.snapshot.rfc?.value).toBe('GOMA850101AB1');
  });

  it('saveRfc solo escribe el RFC (una sede cambiada en memoria no se guarda)', async () => {
    const { id, first } = await twoReads();
    first.assignSite(SITE_2, NOW);
    first.assignRfc(rfcOf('GOMA850101AB9'), NOW);

    expect((await repository.saveRfc(first)).ok).toBe(true);

    const found = await repository.findById(id);
    expect(found?.snapshot.rfc?.value).toBe('GOMA850101AB9');
    expect(found?.snapshot.siteId).toBe(SITE_1);
  });

  it('saveTermination solo escribe estado, fecha y motivo', async () => {
    const { id, first } = await twoReads();
    first.assignSite(SITE_2, NOW);
    first.terminate(TERMINATION, NOW);

    expect((await repository.saveTermination(first)).ok).toBe(true);

    const found = await repository.findById(id);
    expect(found?.snapshot.status).toBe('TERMINATED');
    expect(found?.snapshot.termination).toEqual(TERMINATION);
    expect(found?.snapshot.siteId).toBe(SITE_1);
  });

  it('un cambio de sede leído antes de la baja → EMPLOYEE_INACTIVE y la baja queda intacta', async () => {
    const { id, first, second } = await twoReads();
    first.terminate(TERMINATION, NOW);
    await repository.saveTermination(first);
    second.assignSite(SITE_2, NOW);

    const result = await repository.saveSite(second);

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_INACTIVE');
    const found = await repository.findById(id);
    expect(found?.snapshot.status).toBe('TERMINATED');
    expect(found?.snapshot.termination).toEqual(TERMINATION);
    expect(found?.snapshot.siteId).toBe(SITE_1);
  });

  it('un cambio de RFC leído antes de la baja → EMPLOYEE_INACTIVE y el RFC no cambia', async () => {
    const { id, first, second } = await twoReads();
    first.terminate(TERMINATION, NOW);
    await repository.saveTermination(first);
    second.assignRfc(rfcOf('GOMA850101AB9'), NOW);

    const result = await repository.saveRfc(second);

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_INACTIVE');
    const found = await repository.findById(id);
    expect(found?.snapshot.rfc?.value).toBe('GOMA850101AB1');
    expect(found?.snapshot.status).toBe('TERMINATED');
  });

  it('una segunda baja leída antes de la primera → EMPLOYEE_ALREADY_TERMINATED y se conserva la primera', async () => {
    const { id, first, second } = await twoReads();
    first.terminate(TERMINATION, NOW);
    second.terminate({ date: new Date('2026-01-14T00:00:00Z'), reason: 'OTHER' }, NOW);

    expect((await repository.saveTermination(first)).ok).toBe(true);
    const result = await repository.saveTermination(second);

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_TERMINATED');
    expect((await repository.findById(id))?.snapshot.termination).toEqual(TERMINATION);
  });

  it('dos bajas concurrentes: exactamente una se aplica', async () => {
    const { first, second } = await twoReads();
    first.terminate(TERMINATION, NOW);
    second.terminate({ date: new Date('2026-01-14T00:00:00Z'), reason: 'OTHER' }, NOW);

    const results = await Promise.all([
      repository.saveTermination(first),
      repository.saveTermination(second),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok).map((result) => result.error.code)).toEqual([
      'EMPLOYEE_ALREADY_TERMINATED',
    ]);
  });
});
