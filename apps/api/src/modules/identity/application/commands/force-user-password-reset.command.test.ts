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

import { ForceUserPasswordReset } from './force-user-password-reset.command';

class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

const ADMIN = 'user-admin';
const TTL_MS = 3_600_000;

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('ForceUserPasswordReset', () => {
  let users: InMemoryUserRepository;
  let resets: InMemoryPasswordResetRepository;
  let eventBus: RecordingEventBus;
  let jobQueue: RecordingJobQueue;
  let clock: FixedClock;
  let force: ForceUserPasswordReset;

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
    force = new ForceUserPasswordReset({ userRepository: users, passwordResetIssuer: issuer });
    // Externo: sin colaborador vinculado.
    const external = User.register({
      id: 'user-externo' as UserId,
      email: mustEmail('contador@externo.com'),
      passwordHash: 'hash',
      now: clock.now(),
    });
    users.users.set(external.id, external);
  });

  const input = { userId: 'user-externo', requestedBy: ADMIN };

  it('camino feliz con un usuario externo: devuelve id, correo y vencimiento; el correo dice que lo forzó personal', async () => {
    const result = await force.execute(input);

    expect(result.ok && result.value).toEqual({
      id: [...resets.resets.values()][0]?.id,
      email: 'contador@externo.com',
      expiresAt: new Date(clock.now().getTime() + TTL_MS).toISOString(),
    });
    expect(jobQueue.jobs).toHaveLength(1);
    expect(jobQueue.jobs[0]?.name).toBe(SEND_PASSWORD_RESET_EMAIL);
    expect(jobQueue.jobs[0]?.options).toEqual({ sensitive: true });
    expect(jobQueue.jobs[0]?.data).toMatchObject({
      to: 'contador@externo.com',
      forcedByStaff: true,
    });
    expect(eventBus.names()).toEqual([PASSWORD_RESET_REQUESTED]);
    expect([...resets.resets.values()][0]?.snapshot.requestedBy).toBe(ADMIN);
  });

  it('el resultado no expone el token ni su hash', async () => {
    const result = await force.execute(input);

    expect(result.ok && Object.keys(result.value).sort()).toEqual(['email', 'expiresAt', 'id']);
  });

  it('el cooldown no aplica: dos forzados seguidos encolan dos correos', async () => {
    await force.execute(input);
    const second = await force.execute(input);

    expect(second.ok).toBe(true);
    expect(jobQueue.jobs).toHaveLength(2);
  });

  it('usuario inexistente: USER_NOT_FOUND sin guardar ni encolar nada', async () => {
    const result = await force.execute({ ...input, userId: 'nadie' });

    expect(!result.ok && result.error.code).toBe('USER_NOT_FOUND');
    expect(resets.resets.size).toBe(0);
    expect(jobQueue.jobs).toEqual([]);
  });

  it('usuario deshabilitado: USER_DISABLED sin guardar ni encolar nada', async () => {
    users.users.get('user-externo')?.disable(clock.now());

    const result = await force.execute(input);

    expect(!result.ok && result.error.code).toBe('USER_DISABLED');
    expect(resets.resets.size).toBe(0);
    expect(jobQueue.jobs).toEqual([]);
    expect(eventBus.published).toEqual([]);
  });
});
