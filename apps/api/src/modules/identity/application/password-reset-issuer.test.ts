import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransactionRunner } from '@/shared/application/ports';
import {
  FixedClock,
  RecordingEventBus,
  RecordingJobQueue,
  SequentialIdGenerator,
} from '@/shared/testing/fakes';

import { PASSWORD_RESET_REQUESTED } from '../domain/password-reset';
import { User, type UserId } from '../domain/user';
import { CryptoPasswordResetTokens } from '../infrastructure/crypto-password-reset-tokens';
import { InMemoryPasswordResetRepository } from '../infrastructure/in-memory/in-memory-password-reset.repository';
import { InMemoryUserRepository } from '../infrastructure/in-memory/in-memory-user.repository';

import { SEND_PASSWORD_RESET_EMAIL } from './jobs/send-password-reset-email.job';
import { PasswordResetIssuer } from './password-reset-issuer';

/** Registra el orden de las operaciones para probar que el bloqueo va primero, dentro de la transacción. */
class OrderedTransactionRunner implements TransactionRunner {
  inside = false;

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.inside = true;
    try {
      return await work();
    } finally {
      this.inside = false;
    }
  }
}

class SpyUserRepository extends InMemoryUserRepository {
  locks: { id: string; insideTransaction: boolean }[] = [];

  constructor(private readonly runner: OrderedTransactionRunner) {
    super();
  }

  override lock(id: UserId): Promise<boolean> {
    this.locks.push({ id, insideTransaction: this.runner.inside });
    return super.lock(id);
  }
}

const APP_URL = 'https://rrhh.example.test';
const TTL_MS = 3_600_000;
const COOLDOWN_MS = 180_000;
const STAFF = 'user-rrhh' as UserId;

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('PasswordResetIssuer', () => {
  let runner: OrderedTransactionRunner;
  let users: SpyUserRepository;
  let resets: InMemoryPasswordResetRepository;
  let eventBus: RecordingEventBus;
  let jobQueue: RecordingJobQueue;
  let clock: FixedClock;
  let tokens: CryptoPasswordResetTokens;
  let issuer: PasswordResetIssuer;
  let ana: User;

  beforeEach(() => {
    runner = new OrderedTransactionRunner();
    users = new SpyUserRepository(runner);
    resets = new InMemoryPasswordResetRepository();
    eventBus = new RecordingEventBus();
    jobQueue = new RecordingJobQueue();
    clock = new FixedClock();
    tokens = new CryptoPasswordResetTokens();
    ana = User.register({
      id: 'user-ana' as UserId,
      email: mustEmail('ana@aps.cl'),
      passwordHash: 'hash',
      now: clock.now(),
    });
    users.users.set(ana.id, ana);
    issuer = new PasswordResetIssuer({
      passwordResetRepository: resets,
      userRepository: users,
      passwordResetTokens: tokens,
      passwordResetPolicy: { ttlMs: TTL_MS, cooldownMs: COOLDOWN_MS, appPublicUrl: APP_URL },
      idGenerator: new SequentialIdGenerator(),
      transactionRunner: runner,
      clock,
      eventBus,
      jobQueue,
    });
  });

  const requested = { requestedBy: null, respectCooldown: true };

  it('guarda el restablecimiento, publica PASSWORD_RESET_REQUESTED y lo devuelve', async () => {
    const reset = await issuer.issue({ user: ana, ...requested });

    expect(reset?.snapshot).toMatchObject({
      userId: ana.id,
      requestedBy: null,
      expiresAt: new Date(clock.now().getTime() + TTL_MS),
    });
    expect(resets.resets.size).toBe(1);
    expect(eventBus.names()).toEqual([PASSWORD_RESET_REQUESTED]);
  });

  it('bloquea la fila del usuario dentro de la transacción', async () => {
    await issuer.issue({ user: ana, ...requested });

    expect(users.locks).toEqual([{ id: ana.id, insideTransaction: true }]);
  });

  it('encola el correo como sensitive con enlace a /restablecer y sin guardar el token en claro', async () => {
    await issuer.issue({ user: ana, ...requested });

    expect(jobQueue.jobs).toHaveLength(1);
    const [job] = jobQueue.jobs;
    expect(job?.name).toBe(SEND_PASSWORD_RESET_EMAIL);
    expect(job?.options).toEqual({ sensitive: true });
    const data = job?.data as { to: string; link: string; expiresAt: string };
    expect(data.to).toBe('ana@aps.cl');
    expect(data.expiresAt).toBe(new Date(clock.now().getTime() + TTL_MS).toISOString());
    expect(data.link.startsWith(`${APP_URL}/restablecer?token=`)).toBe(true);
    const token = data.link.slice(`${APP_URL}/restablecer?token=`.length);
    expect(token.length).toBeGreaterThan(20);
    const [saved] = [...resets.resets.values()];
    expect(saved?.snapshot.tokenHash).not.toBe(token);
    expect(saved?.snapshot.tokenHash).toBe(new CryptoPasswordResetTokens().hashOf(token));
  });

  it('forcedByStaff es false si lo pidió el usuario y true si lo forzó el personal', async () => {
    await issuer.issue({ user: ana, requestedBy: null, respectCooldown: false });
    await issuer.issue({ user: ana, requestedBy: STAFF, respectCooldown: false });

    const flags = jobQueue.jobs.map(
      (job) => (job.data as { forcedByStaff: boolean }).forcedByStaff,
    );
    expect(flags).toEqual([false, true]);
  });

  it('un restablecimiento nuevo reemplaza al pendiente anterior', async () => {
    const first = await issuer.issue({ user: ana, requestedBy: null, respectCooldown: false });
    const second = await issuer.issue({ user: ana, requestedBy: STAFF, respectCooldown: false });

    const now = clock.now();
    expect(resets.resets.get(first?.id ?? '')?.isPendingAt(now)).toBe(false);
    expect(resets.resets.get(first?.id ?? '')?.snapshot.revokedAt).toEqual(now);
    expect(resets.resets.get(second?.id ?? '')?.isPendingAt(now)).toBe(true);
    expect([...resets.resets.values()].filter((r) => r.isPendingAt(now))).toHaveLength(1);
  });

  it('respectCooldown: con uno pendiente más reciente que el cooldown devuelve null sin tocar nada', async () => {
    await issuer.issue({ user: ana, ...requested });
    jobQueue.jobs.length = 0;
    eventBus.published.length = 0;
    clock.set(new Date(clock.now().getTime() + COOLDOWN_MS - 1));

    const second = await issuer.issue({ user: ana, ...requested });

    expect(second).toBeNull();
    expect(resets.resets.size).toBe(1);
    expect([...resets.resets.values()][0]?.snapshot.revokedAt).toBeNull();
    expect(jobQueue.jobs).toEqual([]);
    expect(eventBus.published).toEqual([]);
  });

  it('respectCooldown: pasado el cooldown emite uno nuevo y reemplaza el anterior', async () => {
    await issuer.issue({ user: ana, ...requested });
    clock.set(new Date(clock.now().getTime() + COOLDOWN_MS + 1));

    const second = await issuer.issue({ user: ana, ...requested });

    expect(second).not.toBeNull();
    expect(resets.resets.size).toBe(2);
    expect(jobQueue.jobs).toHaveLength(2);
  });

  it('respectCooldown: justo en el límite del cooldown ya se permite (el borde es exclusivo)', async () => {
    await issuer.issue({ user: ana, ...requested });
    clock.set(new Date(clock.now().getTime() + COOLDOWN_MS));

    const second = await issuer.issue({ user: ana, ...requested });

    expect(second).not.toBeNull();
  });

  it('sin respectCooldown (forzado) el cooldown no aplica', async () => {
    await issuer.issue({ user: ana, ...requested });

    const forced = await issuer.issue({ user: ana, requestedBy: STAFF, respectCooldown: false });

    expect(forced).not.toBeNull();
    expect(jobQueue.jobs).toHaveLength(2);
  });

  it('el cooldown ignora restablecimientos ya usados o reemplazados (no están pendientes)', async () => {
    const first = await issuer.issue({ user: ana, ...requested });
    const stored = resets.resets.get(first?.id ?? '');
    stored?.supersede(clock.now());

    const second = await issuer.issue({ user: ana, ...requested });

    expect(second).not.toBeNull();
  });

  it('el cooldown es por usuario: otro usuario puede pedir de inmediato', async () => {
    const pedro = User.register({
      id: 'user-pedro' as UserId,
      email: mustEmail('pedro@aps.cl'),
      passwordHash: 'hash',
      now: clock.now(),
    });
    users.users.set(pedro.id, pedro);
    await issuer.issue({ user: ana, ...requested });

    const other = await issuer.issue({ user: pedro, ...requested });

    expect(other).not.toBeNull();
  });
});
