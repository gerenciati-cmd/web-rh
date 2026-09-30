import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransactionRunner } from '@/shared/application/ports';
import {
  FixedClock,
  RecordingEventBus,
  RecordingJobQueue,
  SequentialIdGenerator,
} from '@/shared/testing/fakes';

import { User, type UserId } from '../../domain/user';
import { CryptoPasswordResetTokens } from '../../infrastructure/crypto-password-reset-tokens';
import { InMemoryPasswordResetRepository } from '../../infrastructure/in-memory/in-memory-password-reset.repository';
import { InMemoryUserRepository } from '../../infrastructure/in-memory/in-memory-user.repository';
import { SEND_PASSWORD_RESET_EMAIL } from '../jobs/send-password-reset-email.job';
import { PasswordResetIssuer } from '../password-reset-issuer';

import { RequestPasswordReset } from './request-password-reset.command';

class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

const APP_URL = 'https://rrhh.example.test';
const COOLDOWN_MS = 180_000;

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('RequestPasswordReset', () => {
  let users: InMemoryUserRepository;
  let resets: InMemoryPasswordResetRepository;
  let eventBus: RecordingEventBus;
  let jobQueue: RecordingJobQueue;
  let clock: FixedClock;
  let request: RequestPasswordReset;

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
      passwordResetPolicy: { ttlMs: 3_600_000, cooldownMs: COOLDOWN_MS, appPublicUrl: APP_URL },
      idGenerator: new SequentialIdGenerator(),
      transactionRunner: new NoopTransactionRunner(),
      clock,
      eventBus,
      jobQueue,
    });
    request = new RequestPasswordReset({ userRepository: users, passwordResetIssuer: issuer });
    const ana = User.register({
      id: 'user-ana' as UserId,
      email: mustEmail('ana@aps.cl'),
      passwordHash: 'hash',
      now: clock.now(),
    });
    users.users.set(ana.id, ana);
  });

  function nothingHappened() {
    expect(resets.resets.size).toBe(0);
    expect(jobQueue.jobs).toEqual([]);
    expect(eventBus.published).toEqual([]);
  }

  it('usuario activo: responde ok, guarda el restablecimiento y encola un correo a su dirección', async () => {
    const result = await request.execute({ email: 'ana@aps.cl' });

    expect(result.ok).toBe(true);
    expect(resets.resets.size).toBe(1);
    expect([...resets.resets.values()][0]?.snapshot.requestedBy).toBeNull();
    expect(jobQueue.jobs).toHaveLength(1);
    expect(jobQueue.jobs[0]?.name).toBe(SEND_PASSWORD_RESET_EMAIL);
    expect(jobQueue.jobs[0]?.data).toMatchObject({ to: 'ana@aps.cl', forcedByStaff: false });
  });

  it('normaliza el correo: mayúsculas y espacios llegan al mismo usuario', async () => {
    await request.execute({ email: '  Ana@APS.cl ' });

    expect(jobQueue.jobs).toHaveLength(1);
  });

  it('correo desconocido: ok y nada ocurre', async () => {
    const result = await request.execute({ email: 'nadie@aps.cl' });

    expect(result.ok).toBe(true);
    nothingHappened();
  });

  it('correo con formato inválido: ok y nada ocurre', async () => {
    const result = await request.execute({ email: 'no-es-correo' });

    expect(result.ok).toBe(true);
    nothingHappened();
  });

  it('usuario deshabilitado: ok y nada ocurre', async () => {
    users.users.get('user-ana')?.disable(clock.now());

    const result = await request.execute({ email: 'ana@aps.cl' });

    expect(result.ok).toBe(true);
    nothingHappened();
  });

  it('segunda solicitud dentro del cooldown: ok pero sin segundo correo ni reemplazo', async () => {
    await request.execute({ email: 'ana@aps.cl' });
    clock.set(new Date(clock.now().getTime() + COOLDOWN_MS - 1));

    const second = await request.execute({ email: 'ana@aps.cl' });

    expect(second.ok).toBe(true);
    expect(jobQueue.jobs).toHaveLength(1);
    expect(resets.resets.size).toBe(1);
  });

  it('pasado el cooldown: nuevo correo y el enlace anterior queda reemplazado', async () => {
    await request.execute({ email: 'ana@aps.cl' });
    clock.set(new Date(clock.now().getTime() + COOLDOWN_MS + 1));

    await request.execute({ email: 'ana@aps.cl' });

    expect(jobQueue.jobs).toHaveLength(2);
    const pending = [...resets.resets.values()].filter((r) => r.isPendingAt(clock.now()));
    expect(pending).toHaveLength(1);
  });

  it('la respuesta es idéntica exista o no la cuenta', async () => {
    const existing = await request.execute({ email: 'ana@aps.cl' });
    const unknown = await request.execute({ email: 'nadie@aps.cl' });

    expect(existing).toEqual(unknown);
  });
});
