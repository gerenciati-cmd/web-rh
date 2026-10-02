import { Email, NationalId, PersonalRfc } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, RecordingEventBus } from '@/shared/testing/fakes';

import { Employee, type EmployeeId } from '../../domain/employee';
import { EmployeeRfcAlreadyRegisteredError } from '../../domain/errors';
import { InMemoryEmployeeRepository } from '../../infrastructure/in-memory/in-memory-employee.repository';

import { AssignEmployeeRfc } from './assign-employee-rfc.command';

const COMPANY = 'company-a';
const OTHER_COMPANY = 'company-b';

/** Colaborador restaurado como fila anterior al campo RFC (rfc nulo) o ya con RFC. */
function employee(input: {
  id: string;
  companyId?: string;
  country?: 'MX' | 'DO';
  curp?: string;
  rfc?: string | null;
}): Employee {
  const country = input.country ?? 'MX';
  const nationalId =
    country === 'MX'
      ? NationalId.create('MX', input.curp ?? 'GOMA850101HQRRRN04')
      : NationalId.create('DO', '00113918205');
  const email = Email.create(`${input.id}@aps.example`);
  const rfc = input.rfc ? PersonalRfc.create(input.rfc) : null;
  if (!nationalId.ok || !email.ok || (rfc && !rfc.ok)) throw new Error('fixture inválido');
  return Employee.restore(input.id as EmployeeId, {
    companyId: input.companyId ?? COMPANY,
    nationalId: nationalId.value,
    rfc: rfc?.ok ? rfc.value : null,
    siteId: 'site-1',
    firstName: 'Ana',
    lastName: 'Rojas',
    email: email.value,
    positionTitle: null,
    hireDate: new Date('2026-01-01T00:00:00Z'),
    status: 'ACTIVE',
  });
}

describe('AssignEmployeeRfc', () => {
  let repository: InMemoryEmployeeRepository;
  let assignEmployeeRfc: AssignEmployeeRfc;

  beforeEach(() => {
    repository = new InMemoryEmployeeRepository();
    assignEmployeeRfc = new AssignEmployeeRfc({
      employeeRepository: repository,
      clock: new FixedClock(),
      eventBus: new RecordingEventBus(),
    });
  });

  const seed = async (e: Employee) => {
    await repository.save(e);
  };
  const rfcOf = (id: string) => repository.employees.get(id)?.snapshot.rfc?.value ?? null;

  it('captura el RFC de un colaborador sin RFC y lo normaliza', async () => {
    await seed(employee({ id: 'emp-1' }));

    const result = await assignEmployeeRfc.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      rfc: 'goma850101ab1',
    });

    expect(result.ok).toBe(true);
    expect(rfcOf('emp-1')).toBe('GOMA850101AB1');
  });

  it('corrige un RFC ya capturado', async () => {
    await seed(employee({ id: 'emp-1', rfc: 'GOMA850101AB1' }));

    const result = await assignEmployeeRfc.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      rfc: 'GOMA850101AB2',
    });

    expect(result.ok).toBe(true);
    expect(rfcOf('emp-1')).toBe('GOMA850101AB2');
  });

  it('es idempotente: repetir el mismo RFC del mismo colaborador es ok', async () => {
    await seed(employee({ id: 'emp-1', rfc: 'GOMA850101AB1' }));

    const result = await assignEmployeeRfc.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      rfc: 'GOMA850101AB1',
    });

    expect(result.ok).toBe(true);
    expect(rfcOf('emp-1')).toBe('GOMA850101AB1');
  });

  it('rechaza un RFC inválido sin tocar al colaborador', async () => {
    await seed(employee({ id: 'emp-1' }));

    const result = await assignEmployeeRfc.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      rfc: 'GOMA851301AB1',
    });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
    expect(rfcOf('emp-1')).toBeNull();
  });

  it('EMPLOYEE_NOT_FOUND si el colaborador no existe', async () => {
    const result = await assignEmployeeRfc.execute({
      companyId: COMPANY,
      employeeId: 'nope',
      rfc: 'GOMA850101AB1',
    });
    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('EMPLOYEE_NOT_FOUND si el colaborador es de otra empresa (no revela que existe)', async () => {
    await seed(employee({ id: 'emp-1', companyId: OTHER_COMPANY }));

    const result = await assignEmployeeRfc.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      rfc: 'GOMA850101AB1',
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(rfcOf('emp-1')).toBeNull();
  });

  it('EMPLOYEE_RFC_ALREADY_REGISTERED si el RFC es de otro colaborador, incluso de otra empresa', async () => {
    await seed(employee({ id: 'emp-1', companyId: OTHER_COMPANY, rfc: 'GOMA850101AB1' }));
    await seed(employee({ id: 'emp-2', curp: 'PEXL900215MDFRPR07' }));

    const result = await assignEmployeeRfc.execute({
      companyId: COMPANY,
      employeeId: 'emp-2',
      rfc: 'goma850101ab1',
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_RFC_ALREADY_REGISTERED');
    expect(rfcOf('emp-2')).toBeNull();
  });

  it('RFC_NOT_APPLICABLE si el colaborador no es de México', async () => {
    await seed(employee({ id: 'emp-do', country: 'DO' }));

    const result = await assignEmployeeRfc.execute({
      companyId: COMPANY,
      employeeId: 'emp-do',
      rfc: 'GOMA850101AB1',
    });

    expect(!result.ok && result.error.code).toBe('RFC_NOT_APPLICABLE');
    expect(rfcOf('emp-do')).toBeNull();
  });

  it('propaga el conflicto de save (carrera contra el índice único)', async () => {
    await seed(employee({ id: 'emp-1' }));
    vi.spyOn(repository, 'save').mockResolvedValue({
      ok: false,
      error: new EmployeeRfcAlreadyRegisteredError('GOMA850101AB1'),
    });

    const result = await assignEmployeeRfc.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      rfc: 'GOMA850101AB1',
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_RFC_ALREADY_REGISTERED');
  });
});
