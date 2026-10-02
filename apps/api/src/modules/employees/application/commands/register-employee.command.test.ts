import { err } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { EMPLOYEE_HIRED } from '../../domain/employee';
import { EmployeeAlreadyExistsError } from '../../domain/errors';
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
        { id: ACTIVE, country: 'MX', active: true },
        { id: INACTIVE, country: 'MX', active: false },
      ]),
      idGenerator: new SequentialIdGenerator(),
      clock: new FixedClock(),
      eventBus,
    });
  });

  const input: RegisterEmployeeInput = {
    companyId: ACTIVE,
    nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
    rfc: 'GOMA850101AB1',
    firstName: 'Ana',
    lastName: 'Rojas',
    email: 'Ana@APS.cl',
    hireDate: '2026-01-10',
  };

  it('registra al colaborador y publica EMPLOYEE_HIRED', async () => {
    const result = await registerEmployee.execute(input);

    expect(result.ok).toBe(true);
    expect(repository.employees.size).toBe(1);
    expect([...repository.employees.values()][0]?.snapshot.email.value).toBe('ana@aps.cl');
    expect(eventBus.names()).toEqual([EMPLOYEE_HIRED]);
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

  it('propaga conflicto de save sin publicar evento', async () => {
    vi.spyOn(repository, 'save').mockResolvedValue(
      err(new EmployeeAlreadyExistsError('GOMA850101HQRRRN04')),
    );
    const result = await registerEmployee.execute(input);
    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_EXISTS');
    expect(eventBus.names()).toEqual([]);
  });
  it('no convierte fallos inesperados en conflicto', async () => {
    const failure = new Error('persistencia no disponible');
    vi.spyOn(repository, 'save').mockRejectedValue(failure);
    await expect(registerEmployee.execute(input)).rejects.toBe(failure);
    expect(eventBus.names()).toEqual([]);
  });
  it('dos comandos concurrentes persisten uno y publican un evento', async () => {
    const results = await Promise.all([
      registerEmployee.execute(input),
      registerEmployee.execute(input),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.error.code === 'EMPLOYEE_ALREADY_EXISTS'),
    ).toHaveLength(1);
    expect(eventBus.names()).toHaveLength(1);
  });
});
