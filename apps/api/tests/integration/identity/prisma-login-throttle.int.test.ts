import { describe, expect, it } from 'vitest';

import { PrismaTransactionRunner } from '@/infrastructure/database/prisma-transaction-runner';
import { LoginThrottle, type LoginThrottlePolicy } from '@/modules/identity/domain/login-throttle';
import { PrismaLoginThrottleRepository } from '@/modules/identity/infrastructure/prisma-login-throttle.repository';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['identity.login_throttles']);
const transactionRunner = new PrismaTransactionRunner({ database });
const repository = new PrismaLoginThrottleRepository({ database });
const NOW = new Date('2026-01-15T12:00:00Z');
const POLICY: LoginThrottlePolicy = { maxFailures: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

// `lock` reemplazó a `find` (H3, plan 001 paso 15): siempre debe llamarse dentro de
// `transactionRunner.run` (si no, el `SELECT … FOR UPDATE` suelta el lock de inmediato).
describe('PrismaLoginThrottleRepository', () => {
  it('lock crea la fila si no existe, sin fallos ni bloqueo', async () => {
    const throttle = await transactionRunner.run(() => repository.lock('email:nueva@aps.cl', NOW));

    expect(throttle.snapshot).toEqual({ failures: 0, windowStartedAt: NOW, blockedUntil: null });
  });

  it('lock devuelve la fila existente en vez de reiniciarla', async () => {
    const seed = LoginThrottle.fresh('email:ana@aps.cl', NOW);
    seed.registerAttempt(NOW, POLICY);
    await repository.save(seed);

    const throttle = await transactionRunner.run(() => repository.lock('email:ana@aps.cl', NOW));

    expect(throttle.snapshot.failures).toBe(1);
  });

  it('save (upsert) refleja fallos acumulados y el bloqueo resultante', async () => {
    const throttle = LoginThrottle.fresh('email:bloqueada@aps.cl', NOW);
    for (let i = 0; i < POLICY.maxFailures; i++) throttle.registerAttempt(NOW, POLICY);
    await repository.save(throttle);

    const found = await transactionRunner.run(() => repository.lock('email:bloqueada@aps.cl', NOW));

    expect(found.snapshot.failures).toBe(POLICY.maxFailures);
    expect(found.blockedUntilAt(NOW)).toEqual(new Date(NOW.getTime() + POLICY.blockMs));
  });

  it('save vuelve a guardar la misma clave (upsert), sin duplicar filas', async () => {
    const throttle = LoginThrottle.fresh('email:upsert@aps.cl', NOW);
    await repository.save(throttle);

    throttle.registerAttempt(NOW, POLICY);
    await repository.save(throttle);

    const found = await transactionRunner.run(() => repository.lock('email:upsert@aps.cl', NOW));
    expect(found.snapshot.failures).toBe(1);
  });

  it('lock serializa reservas concurrentes sobre la misma llave: no se pierde ningún incremento', async () => {
    const key = 'email:concurrente@aps.cl';
    const attempt = () =>
      transactionRunner.run(async () => {
        const throttle = await repository.lock(key, NOW);
        throttle.registerAttempt(NOW, POLICY);
        await repository.save(throttle);
      });

    // Sin el row lock, las dos transacciones leerían failures=0 en paralelo y ambas
    // escribirían 1 (lost update). Con el lock, la segunda espera a la primera.
    await Promise.all([attempt(), attempt()]);

    const found = await transactionRunner.run(() => repository.lock(key, NOW));
    expect(found.snapshot.failures).toBe(2);
  });
});
