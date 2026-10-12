import { Email, NationalId } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, RecordingEventBus } from '@/shared/testing/fakes';

import { Employee, EMPLOYEE_TERMINATED, type EmployeeId } from '../../domain/employee';
import { EmployeeAlreadyTerminatedError } from '../../domain/errors';
import { InMemoryEmployeeRepository } from '../../infrastructure/in-memory/in-memory-employee.repository';

import { TerminateEmployee } from './terminate-employee.command';

const COMPANY = 'company-a';
const OTHER_COMPANY = 'company-b';

/** El reloj de FixedClock es 2026-01-15T12:00:00Z; la contratación es 2026-01-01. */
function employee(input: { id: string; companyId?: string }): Employee {
  const nationalId = NationalId.create('MX', 'GOMA850101HQRRRN04');
  const email = Email.create(`${input.id}@aps.example`);
  if (!nationalId.ok || !email.ok) throw new Error('fixture inválido');
  return Employee.restore(input.id as EmployeeId, {
    companyId: input.companyId ?? COMPANY,
    nationalId: nationalId.value,
    rfc: null,
    siteId: 'site-1',
    firstName: 'Ana',
    lastName: 'Rojas',
    email: email.value,
    positionTitle: null,
    hireDate: new Date('2026-01-01T00:00:00Z'),
    status: 'ACTIVE',
  });
}

describe('TerminateEmployee', () => {
  let repository: InMemoryEmployeeRepository;
  let eventBus: RecordingEventBus;
  let terminateEmployee: TerminateEmployee;

  beforeEach(() => {
    repository = new InMemoryEmployeeRepository();
    eventBus = new RecordingEventBus();
    terminateEmployee = new TerminateEmployee({
      employeeRepository: repository,
      clock: new FixedClock(),
      eventBus,
    });
  });

  const seed = async (e: Employee) => {
    await repository.add(e);
  };
  const stored = (id: string) => repository.employees.get(id)?.snapshot;

  it('da de baja: guarda fecha (medianoche UTC) y motivo, y publica EMPLOYEE_TERMINATED', async () => {
    await seed(employee({ id: 'emp-1' }));

    const result = await terminateEmployee.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      terminationDate: '2026-01-10',
      reason: 'VOLUNTARY_RESIGNATION',
    });

    expect(result.ok).toBe(true);
    expect(stored('emp-1')?.status).toBe('TERMINATED');
    expect(stored('emp-1')?.termination).toEqual({
      date: new Date('2026-01-10T00:00:00Z'),
      reason: 'VOLUNTARY_RESIGNATION',
    });
    expect(eventBus.names()).toEqual([EMPLOYEE_TERMINATED]);
    expect(eventBus.published[0]?.payload).toEqual({
      employeeId: 'emp-1',
      terminationDate: new Date('2026-01-10T00:00:00Z'),
    });
  });

  it('acepta la fecha de hoy según el reloj', async () => {
    await seed(employee({ id: 'emp-1' }));

    const result = await terminateEmployee.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      terminationDate: '2026-01-15',
      reason: 'END_OF_CONTRACT',
    });

    expect(result.ok).toBe(true);
  });

  it('EMPLOYEE_NOT_FOUND si el colaborador no existe', async () => {
    const result = await terminateEmployee.execute({
      companyId: COMPANY,
      employeeId: 'nope',
      terminationDate: '2026-01-10',
      reason: 'OTHER',
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(eventBus.names()).toEqual([]);
  });

  it('EMPLOYEE_NOT_FOUND si es de otra empresa, sin darlo de baja', async () => {
    await seed(employee({ id: 'emp-1', companyId: OTHER_COMPANY }));

    const result = await terminateEmployee.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      terminationDate: '2026-01-10',
      reason: 'OTHER',
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
    expect(stored('emp-1')?.status).toBe('ACTIVE');
    expect(eventBus.names()).toEqual([]);
  });

  it('TERMINATION_DATE_IN_FUTURE: mañana según el reloj, sin guardar ni publicar', async () => {
    await seed(employee({ id: 'emp-1' }));
    const save = vi.spyOn(repository, 'saveTermination');

    const result = await terminateEmployee.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      terminationDate: '2026-01-16',
      reason: 'OTHER',
    });

    expect(!result.ok && result.error.code).toBe('TERMINATION_DATE_IN_FUTURE');
    expect(save).not.toHaveBeenCalled();
    expect(eventBus.names()).toEqual([]);
  });

  it('TERMINATION_BEFORE_HIRE si la fecha es anterior a la contratación', async () => {
    await seed(employee({ id: 'emp-1' }));

    const result = await terminateEmployee.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      terminationDate: '2025-12-31',
      reason: 'OTHER',
    });

    expect(!result.ok && result.error.code).toBe('TERMINATION_BEFORE_HIRE');
    expect(stored('emp-1')?.status).toBe('ACTIVE');
  });

  it('EMPLOYEE_ALREADY_TERMINATED en la segunda baja; solo se publica la primera', async () => {
    await seed(employee({ id: 'emp-1' }));
    const input = {
      companyId: COMPANY,
      employeeId: 'emp-1',
      terminationDate: '2026-01-10',
      reason: 'OTHER' as const,
    };
    await terminateEmployee.execute(input);

    const result = await terminateEmployee.execute({ ...input, terminationDate: '2026-01-12' });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_TERMINATED');
    expect(eventBus.names()).toEqual([EMPLOYEE_TERMINATED]);
    expect(stored('emp-1')?.termination?.date).toEqual(new Date('2026-01-10T00:00:00Z'));
  });

  it('propaga el err de save y no publica', async () => {
    await seed(employee({ id: 'emp-1' }));
    vi.spyOn(repository, 'saveTermination').mockResolvedValue({
      ok: false,
      error: new EmployeeAlreadyTerminatedError('emp-1'),
    });

    const result = await terminateEmployee.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      terminationDate: '2026-01-10',
      reason: 'OTHER',
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_TERMINATED');
    expect(eventBus.names()).toEqual([]);
  });

  it('escribe con saveTermination (employees-desvinculacion/002)', async () => {
    await seed(employee({ id: 'emp-1' }));
    const saveTermination = vi.spyOn(repository, 'saveTermination');

    await terminateEmployee.execute({
      companyId: COMPANY,
      employeeId: 'emp-1',
      terminationDate: '2026-01-10',
      reason: 'OTHER',
    });

    expect(saveTermination).toHaveBeenCalledTimes(1);
  });
});
