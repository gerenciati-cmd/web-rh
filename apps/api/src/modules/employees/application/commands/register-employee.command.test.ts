import { beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { EmployeeHired } from '../../domain/employee';
import { InMemoryEmployeeRepository } from '../../infrastructure/in-memory/in-memory-employee.repository';
import type { Employer, EmployerDirectory } from '../ports/employer-directory';

import { RegisterEmployee, type RegisterEmployeeInput } from './register-employee.command';

/** Doble del puerto: employees se testea SIN el módulo organization. */
class StubEmployerDirectory implements EmployerDirectory {
  constructor(private readonly employers: Employer[]) {}

  find(companyId: string): Promise<Employer | null> {
    return Promise.resolve(this.employers.find((e) => e.id === companyId) ?? null);
  }
}

const ACTIVE = 'company-active';
const INACTIVE = 'company-inactive';

describe('RegisterEmployee', () => {
  let repository: InMemoryEmployeeRepository;
  let eventBus: RecordingEventBus;
  let registerEmployee: RegisterEmployee;

  beforeEach(() => {
    repository = new InMemoryEmployeeRepository();
    eventBus = new RecordingEventBus();
    registerEmployee = new RegisterEmployee({
      employeeRepository: repository,
      employerDirectory: new StubEmployerDirectory([
        { id: ACTIVE, country: 'CL', active: true },
        { id: INACTIVE, country: 'CL', active: false },
      ]),
      idGenerator: new SequentialIdGenerator(),
      clock: new FixedClock(),
      eventBus,
    });
  });

  const input: RegisterEmployeeInput = {
    companyId: ACTIVE,
    nationalId: { country: 'CL', number: '12.345.678-5' },
    firstName: 'Ana',
    lastName: 'Rojas',
    email: 'Ana@APS.cl',
    hireDate: '2026-01-10',
  };

  it('registra al colaborador y publica EmployeeHired', async () => {
    const result = await registerEmployee.execute(input);

    expect(result.ok).toBe(true);
    expect(repository.employees.size).toBe(1);
    expect([...repository.employees.values()][0]?.snapshot.email.value).toBe('ana@aps.cl');
    expect(eventBus.names()).toEqual([EmployeeHired]);
  });

  it.each([
    ['empresa inexistente', { companyId: 'nope' }, 'COMPANY_NOT_FOUND'],
    ['empresa inactiva', { companyId: INACTIVE }, 'COMPANY_INACTIVE'],
    ['email inválido', { email: 'no-es-email' }, 'INVALID_VALUE'],
  ])('rechaza %s', async (_case, overrides, code) => {
    const result = await registerEmployee.execute({ ...input, ...overrides });
    expect(!result.ok && result.error.code).toBe(code);
    expect(repository.employees.size).toBe(0);
  });

  it('rechaza un colaborador duplicado en la misma empresa', async () => {
    await registerEmployee.execute(input);
    const result = await registerEmployee.execute(input);
    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_EXISTS');
  });
});
