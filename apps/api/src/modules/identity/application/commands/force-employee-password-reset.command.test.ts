import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransactionRunner } from '@/shared/application/ports';
import {
  FixedClock,
  RecordingEventBus,
  RecordingJobQueue,
  SequentialIdGenerator,
} from '@/shared/testing/fakes';

import { PASSWORD_RESET_REQUESTED } from '../../domain/password-reset';
import { User, type UserId } from '../../domain/user';
import { CryptoPasswordResetTokens } from '../../infrastructure/crypto-password-reset-tokens';
import { InMemoryPasswordResetRepository } from '../../infrastructure/in-memory/in-memory-password-reset.repository';
import { InMemoryUserRepository } from '../../infrastructure/in-memory/in-memory-user.repository';
import { SEND_PASSWORD_RESET_EMAIL } from '../jobs/send-password-reset-email.job';
import { PasswordResetIssuer } from '../password-reset-issuer';
import type { EmployeeDirectory, InvitableEmployee } from '../ports/employee-directory';

import { ForceEmployeePasswordReset } from './force-employee-password-reset.command';

class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class StubEmployeeDirectory implements EmployeeDirectory {
  constructor(private readonly employees: InvitableEmployee[]) {}

  find(employeeId: string): Promise<InvitableEmployee | null> {
    return Promise.resolve(this.employees.find((e) => e.id === employeeId) ?? null);
  }
}

const COMPANY = 'company-a';
const STAFF = 'user-rrhh';
const TTL_MS = 3_600_000;
const ana: InvitableEmployee = {
  id: 'employee-ana',
  companyId: COMPANY,
  email: 'ana@aps.cl',
  fullName: 'Ana Rojas',
  active: true,
};
const foreign: InvitableEmployee = { ...ana, id: 'employee-ajeno', companyId: 'company-b' };
const noAccount: InvitableEmployee = { ...ana, id: 'employee-sin-cuenta' };

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('ForceEmployeePasswordReset', () => {
  let users: InMemoryUserRepository;
  let resets: InMemoryPasswordResetRepository;
  let eventBus: RecordingEventBus;
  let jobQueue: RecordingJobQueue;
  let clock: FixedClock;
  let force: ForceEmployeePasswordReset;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    resets = new InMemoryPasswordResetRepository();
    eventBus = new RecordingEventBus();
    jobQueue = new RecordingJobQueue();
    clock = new FixedClock();
    const issuer = new PasswordResetIssuer({
      passwordResetRepository: resets,
      userRepository: users,
      passwordResetTokens: new CryptoPasswordResetTokens(),
      passwordResetPolicy: {
        ttlMs: TTL_MS,
        cooldownMs: 180_000,
        appPublicUrl: 'https://rrhh.example.test',
      },
      idGenerator: new SequentialIdGenerator(),
      transactionRunner: new NoopTransactionRunner(),
      clock,
      eventBus,
      jobQueue,
    });
    force = new ForceEmployeePasswordReset({
      employeeDirectory: new StubEmployeeDirectory([ana, foreign, noAccount]),
      userRepository: users,
      passwordResetIssuer: issuer,
    });
    const account = User.register({
      id: 'user-ana' as UserId,
      email: mustEmail('ana.cuenta@aps.cl'),
      passwordHash: 'hash',
      employeeId: ana.id,
      now: clock.now(),
    });
    users.users.set(account.id, account);
  });

  const input = { companyId: COMPANY, employeeId: ana.id, requestedBy: STAFF };

  function nothingHappened() {
    expect(resets.resets.size).toBe(0);
    expect(jobQueue.jobs).toEqual([]);
    expect(eventBus.published).toEqual([]);
  }

  it('camino feliz: devuelve id, correo de la cuenta y vencimiento; el correo dice que lo forzó personal', async () => {
    const result = await force.execute(input);

    expect(result.ok && result.value).toEqual({
      id: [...resets.resets.values()][0]?.id,
      email: 'ana.cuenta@aps.cl',
      expiresAt: new Date(clock.now().getTime() + TTL_MS).toISOString(),
    });
    expect(jobQueue.jobs).toHaveLength(1);
    expect(jobQueue.jobs[0]?.name).toBe(SEND_PASSWORD_RESET_EMAIL);
    expect(jobQueue.jobs[0]?.options).toEqual({ sensitive: true });
    expect(jobQueue.jobs[0]?.data).toMatchObject({
      to: 'ana.cuenta@aps.cl',
      forcedByStaff: true,
    });
    expect(eventBus.names()).toEqual([PASSWORD_RESET_REQUESTED]);
    expect([...resets.resets.values()][0]?.snapshot.requestedBy).toBe(STAFF);
  });

  it('el resultado no expone el token ni su hash', async () => {
    const result = await force.execute(input);

    expect(result.ok && Object.keys(result.value).sort()).toEqual(['email', 'expiresAt', 'id']);
  });

  it('el cooldown no aplica: dos forzados seguidos encolan dos correos y dejan uno pendiente', async () => {
    await force.execute(input);
    const second = await force.execute(input);

    expect(second.ok).toBe(true);
    expect(jobQueue.jobs).toHaveLength(2);
    expect([...resets.resets.values()].filter((r) => r.isPendingAt(clock.now()))).toHaveLength(1);
  });

  it.each([
    ['colaborador inexistente', { employeeId: 'nadie' }, 'EMPLOYEE_NOT_FOUND'],
    ['colaborador de otra empresa', { employeeId: foreign.id }, 'EMPLOYEE_NOT_FOUND'],
    ['colaborador sin cuenta', { employeeId: noAccount.id }, 'USER_NOT_FOUND'],
  ])('rechaza %s sin guardar ni encolar nada', async (_case, overrides, code) => {
    const result = await force.execute({ ...input, ...overrides });

    expect(!result.ok && result.error.code).toBe(code);
    nothingHappened();
  });

  it('cuenta deshabilitada: USER_DISABLED sin guardar ni encolar nada', async () => {
    users.users.get('user-ana')?.disable(clock.now());

    const result = await force.execute(input);

    expect(!result.ok && result.error.code).toBe('USER_DISABLED');
    nothingHappened();
  });

  it('colaborador de otra empresa responde igual que uno inexistente (mismo mensaje)', async () => {
    const other = await force.execute({ ...input, employeeId: foreign.id });
    const missing = await force.execute({ ...input, employeeId: 'nadie' });

    expect(other).toEqual(missing);
  });
});
