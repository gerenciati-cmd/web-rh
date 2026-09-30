import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransactionRunner } from '@/shared/application/ports';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { ROLE_ASSIGNED } from '../../domain/role-assignment';
import { User, type UserId } from '../../domain/user';
import { InMemoryRoleAssignmentRepository } from '../../infrastructure/in-memory/in-memory-role-assignment.repository';
import { InMemoryUserRepository } from '../../infrastructure/in-memory/in-memory-user.repository';
import type { AssignableCompany, CompanyDirectory } from '../ports/company-directory';

import { AssignRole, type AssignRoleInput } from './assign-role.command';

const NOW = new Date('2026-01-15T12:00:00Z');
const USER_ID = 'user-1' as UserId;
const ACTIVE = 'company-active';
const INACTIVE = 'company-inactive';

/** Doble del puerto: identity se testea SIN el módulo organization. */
class StubCompanyDirectory implements CompanyDirectory {
  constructor(private readonly companies: AssignableCompany[]) {}

  find(companyId: string): Promise<AssignableCompany | null> {
    return Promise.resolve(this.companies.find((c) => c.id === companyId) ?? null);
  }
}

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

describe('AssignRole', () => {
  let userRepository: InMemoryUserRepository;
  let roleAssignmentRepository: InMemoryRoleAssignmentRepository;
  let eventBus: RecordingEventBus;
  let assignRole: AssignRole;

  beforeEach(() => {
    userRepository = new InMemoryUserRepository();
    roleAssignmentRepository = new InMemoryRoleAssignmentRepository({ userRepository });
    eventBus = new RecordingEventBus();
    userRepository.users.set(
      USER_ID,
      User.register({
        id: USER_ID,
        email: mustEmail('ana@aps.cl'),
        passwordHash: 'hash',
        now: NOW,
      }),
    );
    assignRole = new AssignRole({
      userRepository,
      roleAssignmentRepository,
      companyDirectory: new StubCompanyDirectory([
        { id: ACTIVE, active: true },
        { id: INACTIVE, active: false },
      ]),
      idGenerator: new SequentialIdGenerator(),
      transactionRunner: new NoopTransactionRunner(),
      clock: new FixedClock(NOW),
      eventBus,
    });
  });

  const hrInput: AssignRoleInput = {
    userId: USER_ID,
    role: 'HR',
    companyId: ACTIVE,
    assignedBy: 'user-admin',
  };

  it('HR en una empresa activa: guarda la asignación, publica ROLE_ASSIGNED y devuelve el id', async () => {
    const result = await assignRole.execute(hrInput);

    expect(result.ok).toBe(true);
    expect(roleAssignmentRepository.assignments.size).toBe(1);
    const saved = [...roleAssignmentRepository.assignments.values()][0];
    expect(saved?.snapshot).toMatchObject({
      userId: USER_ID,
      role: 'HR',
      companyId: ACTIVE,
      assignedBy: 'user-admin',
      revokedAt: null,
    });
    expect(result.ok && result.value.id).toBe(saved?.id);
    expect(eventBus.names()).toEqual([ROLE_ASSIGNED]);
  });

  it('HOLDING_ADMIN sin empresa no consulta el directorio y queda guardado', async () => {
    const result = await assignRole.execute({
      userId: USER_ID,
      role: 'HOLDING_ADMIN',
      companyId: null,
      assignedBy: null,
    });

    expect(result.ok).toBe(true);
    expect(roleAssignmentRepository.assignments.size).toBe(1);
  });

  it('usuario inexistente: USER_NOT_FOUND y nada se guarda', async () => {
    const result = await assignRole.execute({ ...hrInput, userId: 'no-existe' });

    expect(!result.ok && result.error.code).toBe('USER_NOT_FOUND');
    expect(roleAssignmentRepository.assignments.size).toBe(0);
    expect(eventBus.published).toEqual([]);
  });

  it('rol no asignable: ROLE_NOT_ASSIGNABLE', async () => {
    const result = await assignRole.execute({ ...hrInput, role: 'EMPLOYEE', companyId: null });

    expect(!result.ok && result.error.code).toBe('ROLE_NOT_ASSIGNABLE');
    expect(roleAssignmentRepository.assignments.size).toBe(0);
  });

  it('HR sin empresa: INVALID_ROLE_SCOPE', async () => {
    const result = await assignRole.execute({ ...hrInput, companyId: null });

    expect(!result.ok && result.error.code).toBe('INVALID_ROLE_SCOPE');
  });

  it('HOLDING_ADMIN con empresa: INVALID_ROLE_SCOPE', async () => {
    const result = await assignRole.execute({ ...hrInput, role: 'HOLDING_ADMIN' });

    expect(!result.ok && result.error.code).toBe('INVALID_ROLE_SCOPE');
  });

  it('empresa desconocida: COMPANY_NOT_FOUND', async () => {
    const result = await assignRole.execute({ ...hrInput, companyId: 'no-existe' });

    expect(!result.ok && result.error.code).toBe('COMPANY_NOT_FOUND');
    expect(roleAssignmentRepository.assignments.size).toBe(0);
  });

  it('empresa inactiva: COMPANY_INACTIVE', async () => {
    const result = await assignRole.execute({ ...hrInput, companyId: INACTIVE });

    expect(!result.ok && result.error.code).toBe('COMPANY_INACTIVE');
    expect(roleAssignmentRepository.assignments.size).toBe(0);
  });

  it('mismo rol y misma empresa ya activos: ROLE_ALREADY_ASSIGNED, sin segunda fila ni evento', async () => {
    await assignRole.execute(hrInput);
    const eventsBefore = eventBus.published.length;

    const result = await assignRole.execute(hrInput);

    expect(!result.ok && result.error.code).toBe('ROLE_ALREADY_ASSIGNED');
    expect(roleAssignmentRepository.assignments.size).toBe(1);
    expect(eventBus.published).toHaveLength(eventsBefore);
  });

  describe('serialización por usuario (R4, decisión 18)', () => {
    /** Registra el orden de las llamadas y si ocurren dentro de `run`. */
    function buildWithSpies() {
      const calls: string[] = [];
      let inside = false;
      const runner: TransactionRunner = {
        async run<T>(work: () => Promise<T>): Promise<T> {
          calls.push('begin');
          inside = true;
          try {
            return await work();
          } finally {
            inside = false;
            calls.push('end');
          }
        },
      };
      const lockUser = roleAssignmentRepository.lockUser.bind(roleAssignmentRepository);
      const save = roleAssignmentRepository.save.bind(roleAssignmentRepository);
      const find = roleAssignmentRepository.findActiveByUser.bind(roleAssignmentRepository);
      roleAssignmentRepository.lockUser = (id) => {
        calls.push(inside ? 'lock:in' : 'lock:out');
        return lockUser(id);
      };
      roleAssignmentRepository.findActiveByUser = (id) => {
        calls.push(inside ? 'find:in' : 'find:out');
        return find(id);
      };
      roleAssignmentRepository.save = (assignment) => {
        calls.push(inside ? 'save:in' : 'save:out');
        return save(assignment);
      };
      const directory: CompanyDirectory = {
        find: (id) => {
          calls.push(inside ? 'directory:in' : 'directory:out');
          return Promise.resolve({ id, active: true });
        },
      };
      const command = new AssignRole({
        userRepository,
        roleAssignmentRepository,
        companyDirectory: directory,
        idGenerator: new SequentialIdGenerator(),
        transactionRunner: runner,
        clock: new FixedClock(NOW),
        eventBus,
      });
      return { calls, command };
    }

    it('bloquea al usuario, comprueba duplicado y guarda dentro de la transacción; el directorio va fuera', async () => {
      const { calls, command } = buildWithSpies();

      const result = await command.execute(hrInput);

      expect(result.ok).toBe(true);
      expect(calls).toEqual(['directory:out', 'begin', 'lock:in', 'find:in', 'save:in', 'end']);
    });

    it('el bloqueo devuelve false (usuario borrado tras la primera lectura): USER_NOT_FOUND sin guardar', async () => {
      const { calls, command } = buildWithSpies();
      roleAssignmentRepository.lockUser = () => Promise.resolve(false);

      const result = await command.execute(hrInput);

      expect(!result.ok && result.error.code).toBe('USER_NOT_FOUND');
      expect(roleAssignmentRepository.assignments.size).toBe(0);
      expect(calls).not.toContain('save:in');
      expect(eventBus.published).toEqual([]);
    });

    it('el duplicado se detecta dentro de la transacción y no publica evento', async () => {
      const { calls, command } = buildWithSpies();
      await command.execute(hrInput);
      calls.length = 0;
      const eventsBefore = eventBus.published.length;

      const result = await command.execute(hrInput);

      expect(!result.ok && result.error.code).toBe('ROLE_ALREADY_ASSIGNED');
      expect(calls).toEqual(['directory:out', 'begin', 'lock:in', 'find:in', 'end']);
      expect(eventBus.published).toHaveLength(eventsBefore);
    });
  });

  it('el mismo rol en otra empresa no es duplicado', async () => {
    await assignRole.execute(hrInput);
    const otherCompany = new AssignRole({
      userRepository,
      roleAssignmentRepository,
      companyDirectory: new StubCompanyDirectory([{ id: 'company-b', active: true }]),
      idGenerator: new SequentialIdGenerator(),
      transactionRunner: new NoopTransactionRunner(),
      clock: new FixedClock(NOW),
      eventBus,
    });

    const result = await otherCompany.execute({ ...hrInput, companyId: 'company-b' });

    expect(result.ok).toBe(true);
  });

  it('una asignación revocada no cuenta como duplicado: se puede volver a asignar', async () => {
    await assignRole.execute(hrInput);
    const [first] = [...roleAssignmentRepository.assignments.values()];
    first?.revoke('user-admin' as UserId, NOW);

    const result = await assignRole.execute(hrInput);

    expect(result.ok).toBe(true);
    expect(roleAssignmentRepository.assignments.size).toBe(2);
  });
});
