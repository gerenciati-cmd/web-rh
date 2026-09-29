import { describe, expect, it } from 'vitest';

import { LoginThrottle, type LoginThrottlePolicy } from '@/modules/identity/domain/login-throttle';
import { PrismaLoginThrottleRepository } from '@/modules/identity/infrastructure/prisma-login-throttle.repository';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['identity.login_throttles']);
const repository = new PrismaLoginThrottleRepository({ database });
const NOW = new Date('2026-01-15T12:00:00Z');
const POLICY: LoginThrottlePolicy = { maxFailures: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 };

describe('PrismaLoginThrottleRepository', () => {
  it('guarda y rehidrata un throttle recién creado', async () => {
    const throttle = LoginThrottle.fresh('email:ana@aps.cl', NOW);
    await repository.save(throttle);

    const found = await repository.find('email:ana@aps.cl');

    expect(found?.snapshot).toEqual({ failures: 0, windowStartedAt: NOW, blockedUntil: null });
  });

  it('find devuelve null para una clave inexistente', async () => {
    expect(await repository.find('email:nadie@aps.cl')).toBeNull();
  });

  it('save (upsert) refleja fallos acumulados y el bloqueo resultante', async () => {
    const throttle = LoginThrottle.fresh('email:bloqueada@aps.cl', NOW);
    for (let i = 0; i < POLICY.maxFailures; i++) throttle.registerFailure(NOW, POLICY);
    await repository.save(throttle);

    const found = await repository.find('email:bloqueada@aps.cl');

    expect(found?.snapshot.failures).toBe(POLICY.maxFailures);
    expect(found?.blockedUntilAt(NOW)).toEqual(new Date(NOW.getTime() + POLICY.blockMs));
  });

  it('save vuelve a guardar la misma clave (upsert), sin duplicar filas', async () => {
    const throttle = LoginThrottle.fresh('email:upsert@aps.cl', NOW);
    await repository.save(throttle);

    throttle.registerFailure(NOW, POLICY);
    await repository.save(throttle);

    expect((await repository.find('email:upsert@aps.cl'))?.snapshot.failures).toBe(1);
  });
});
