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
const OTHER = 'company-other';

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
        { id: OTHER, country: 'MX', active: true },
      ]),
      siteDirectory: { find: (id) => Promise.resolve({ id, country: 'MX', active: true }) },
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
    siteId: 'site-1',
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

  describe('RFC', () => {
    it('guarda el RFC normalizado en mayúsculas', async () => {
      await registerEmployee.execute({ ...input, rfc: 'goma850101ab1' });
      expect([...repository.employees.values()][0]?.snapshot.rfc?.value).toBe('GOMA850101AB1');
    });

    it('rechaza a un colaborador de México sin RFC', async () => {
      const result = await registerEmployee.execute({ ...input, rfc: undefined });
      expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
      expect(repository.employees.size).toBe(0);
      expect(eventBus.names()).toEqual([]);
    });

    it('rechaza un RFC inválido', async () => {
      const result = await registerEmployee.execute({ ...input, rfc: 'GOMA851301AB1' });
      expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
      expect(repository.employees.size).toBe(0);
    });

    it('rechaza un RFC en un colaborador que no es de México', async () => {
      const result = await registerEmployee.execute({
        ...input,
        nationalId: { country: 'DO', number: '00113918205' },
      });
      expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
    });

    it('registra sin RFC a un colaborador que no es de México', async () => {
      const result = await registerEmployee.execute({
        ...input,
        nationalId: { country: 'DO', number: '00113918205' },
        rfc: undefined,
      });
      expect(result.ok).toBe(true);
      expect([...repository.employees.values()][0]?.snapshot.rfc).toBeNull();
    });

    it('rechaza un RFC ya usado en otra empresa del holding', async () => {
      await registerEmployee.execute(input);
      const result = await registerEmployee.execute({
        ...input,
        companyId: OTHER,
        nationalId: { country: 'MX', number: 'PEXL900215MDFRPR07' },
      });
      expect(!result.ok && result.error.code).toBe('EMPLOYEE_RFC_ALREADY_REGISTERED');
      expect(repository.employees.size).toBe(1);
      expect(eventBus.names()).toEqual([EMPLOYEE_HIRED]);
    });

    it('detecta el RFC repetido aunque venga en minúsculas', async () => {
      await registerEmployee.execute(input);
      const result = await registerEmployee.execute({
        ...input,
        companyId: OTHER,
        rfc: 'goma850101ab1',
        nationalId: { country: 'MX', number: 'PEXL900215MDFRPR07' },
      });
      expect(!result.ok && result.error.code).toBe('EMPLOYEE_RFC_ALREADY_REGISTERED');
    });

    it('con CURP y RFC repetidos reporta primero el CURP de la empresa', async () => {
      await registerEmployee.execute(input);
      const result = await registerEmployee.execute(input);
      expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_EXISTS');
    });

    it('la misma CURP en otra empresa con otro RFC se registra', async () => {
      await registerEmployee.execute(input);
      const result = await registerEmployee.execute({
        ...input,
        companyId: OTHER,
        rfc: 'GOMA850101AB3',
      });
      expect(result.ok).toBe(true);
      expect(repository.employees.size).toBe(2);
    });
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
