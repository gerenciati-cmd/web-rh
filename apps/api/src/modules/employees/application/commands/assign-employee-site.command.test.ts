import { Email, NationalId, PersonalRfc } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, RecordingEventBus } from '@/shared/testing/fakes';

import { Employee, EMPLOYEE_SITE_ASSIGNED, type EmployeeId } from '../../domain/employee';
import { EmployeeAlreadyExistsError } from '../../domain/errors';
import { InMemoryEmployeeRepository } from '../../infrastructure/in-memory/in-memory-employee.repository';
import type { Employer, EmployerDirectory } from '../ports/employer-directory';
import type { SiteDirectory, WorkSite } from '../ports/site-directory';

import { AssignEmployeeSite } from './assign-employee-site.command';

/** Dobles de los puertos: employees se testea SIN el módulo organization. */
class StubEmployerDirectory implements EmployerDirectory {
  constructor(private readonly employers: Employer[]) {}

  find(companyId: string): Promise<Employer | null> {
    return Promise.resolve(this.employers.find((e) => e.id === companyId) ?? null);
  }
}

class StubSiteDirectory implements SiteDirectory {
  constructor(private readonly sites: WorkSite[]) {}

  find(siteId: string): Promise<WorkSite | null> {
    return Promise.resolve(this.sites.find((s) => s.id === siteId) ?? null);
  }
}

const COMPANY = 'company-a';
const OTHER_COMPANY = 'company-b';
const GHOST_COMPANY = 'company-ghost';

function employee(input: { id: string; companyId?: string; siteId?: string | null }): Employee {
  const nationalId = NationalId.create('MX', 'GOMA850101HQRRRN04');
  const email = Email.create(`${input.id}@aps.example`);
  const rfc = PersonalRfc.create('GOMA850101AB1');
  if (!nationalId.ok || !email.ok || !rfc.ok) throw new Error('fixture inválido');
  return Employee.restore(input.id as EmployeeId, {
    companyId: input.companyId ?? COMPANY,
    nationalId: nationalId.value,
    rfc: rfc.value,
    siteId: input.siteId === undefined ? 'site-1' : input.siteId,
    firstName: 'Ana',
    lastName: 'Rojas',
    email: email.value,
    positionTitle: null,
    hireDate: new Date('2026-01-01T00:00:00Z'),
    status: 'ACTIVE',
  });
}

describe('AssignEmployeeSite', () => {
  let repository: InMemoryEmployeeRepository;
  let eventBus: RecordingEventBus;
  let assignEmployeeSite: AssignEmployeeSite;

  beforeEach(() => {
    repository = new InMemoryEmployeeRepository();
    eventBus = new RecordingEventBus();
    assignEmployeeSite = new AssignEmployeeSite({
      employeeRepository: repository,
      employerDirectory: new StubEmployerDirectory([
        { id: COMPANY, country: 'MX', active: true },
        { id: OTHER_COMPANY, country: 'MX', active: true },
      ]),
      siteDirectory: new StubSiteDirectory([
        { id: 'site-1', country: 'MX', active: true },
        { id: 'site-2', country: 'MX', active: true },
        { id: 'site-inactive', country: 'MX', active: false },
        { id: 'site-do', country: 'DO', active: true },
      ]),
      clock: new FixedClock(),
      eventBus,
    });
  });

  const seed = async (e: Employee) => {
    await repository.save(e);
  };
  const siteOf = (id: string) => repository.employees.get(id)?.snapshot.siteId;
  const run = (siteId: string, employeeId = 'emp-1', companyId = COMPANY) =>
    assignEmployeeSite.execute({ companyId, employeeId, siteId });

  it('cambia la sede y publica EMPLOYEE_SITE_ASSIGNED', async () => {
    await seed(employee({ id: 'emp-1' }));

    const result = await run('site-2');

    expect(result.ok).toBe(true);
    expect(siteOf('emp-1')).toBe('site-2');
    expect(eventBus.names()).toEqual([EMPLOYEE_SITE_ASSIGNED]);
    expect(eventBus.published[0]?.payload).toEqual({
      employeeId: 'emp-1',
      siteId: 'site-2',
      previousSiteId: 'site-1',
    });
  });

  it('asigna sede a un colaborador anterior al campo (siteId null)', async () => {
    await seed(employee({ id: 'emp-1', siteId: null }));

    const result = await run('site-1');

    expect(result.ok).toBe(true);
    expect(siteOf('emp-1')).toBe('site-1');
    expect(eventBus.published[0]?.payload).toMatchObject({ previousSiteId: null });
  });

  it('es idempotente: repetir la misma sede es ok y no publica evento', async () => {
    await seed(employee({ id: 'emp-1' }));

    const result = await run('site-1');

    expect(result.ok).toBe(true);
    expect(siteOf('emp-1')).toBe('site-1');
    expect(eventBus.names()).toEqual([]);
  });

  it('EMPLOYEE_NOT_FOUND si el colaborador no existe', async () => {
    const result = await run('site-2', 'nope');
    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('EMPLOYEE_NOT_FOUND si es de otra empresa (no revela que existe) y no lo toca', async () => {
    await seed(employee({ id: 'emp-1', companyId: OTHER_COMPANY }));

    const result = await run('site-2');

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(siteOf('emp-1')).toBe('site-1');
    expect(eventBus.names()).toEqual([]);
  });

  it('COMPANY_NOT_FOUND si la razón social del colaborador ya no existe en el directorio', async () => {
    await seed(employee({ id: 'emp-1', companyId: GHOST_COMPANY }));

    const result = await run('site-2', 'emp-1', GHOST_COMPANY);

    expect(!result.ok && result.error.code).toBe('COMPANY_NOT_FOUND');
    expect(siteOf('emp-1')).toBe('site-1');
  });

  it.each([
    ['sede inexistente', 'nope', 'SITE_NOT_FOUND'],
    ['sede inactiva', 'site-inactive', 'SITE_INACTIVE'],
    ['sede de otro país que la razón social', 'site-do', 'SITE_COUNTRY_MISMATCH'],
  ])('rechaza %s sin cambiar la sede ni publicar', async (_case, siteId, code) => {
    await seed(employee({ id: 'emp-1' }));

    const result = await run(siteId);

    expect(!result.ok && result.error.code).toBe(code);
    expect(siteOf('emp-1')).toBe('site-1');
    expect(eventBus.names()).toEqual([]);
  });

  it('propaga el fallo de save sin publicar evento', async () => {
    await seed(employee({ id: 'emp-1' }));
    vi.spyOn(repository, 'save').mockResolvedValue({
      ok: false,
      error: new EmployeeAlreadyExistsError('GOMA850101HQRRRN04'),
    });

    const result = await run('site-2');

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_EXISTS');
    expect(eventBus.names()).toEqual([]);
  });
});
