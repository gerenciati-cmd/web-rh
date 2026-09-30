import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { LoginThrottle } from '../domain/login-throttle';
import type { LoginThrottleRepository } from '../domain/login-throttle.repository';

import { LoginThrottleMapper } from './login-throttle.mapper';

/** Fila cruda del `SELECT … FOR UPDATE`: nombres de columna tal cual (snake_case), no pasa por
 *  el mapeo camelCase de Prisma porque es SQL crudo. */
interface RawLoginThrottleRow {
  key: string;
  failures: number;
  window_started_at: Date;
  blocked_until: Date | null;
}

export class PrismaLoginThrottleRepository implements LoginThrottleRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  /**
   * Crea la fila si no existe (`createMany` + `skipDuplicates`, sin fallar si otra petición
   * llega primero) y la bloquea con `SELECT … FOR UPDATE`: debe llamarse dentro de
   * `transactionRunner.run`, si no el lock se libera al terminar esta sola consulta y no
   * serializa nada frente a intentos concurrentes (H3).
   */
  async lock(key: string, now: Date): Promise<LoginThrottle> {
    const { database } = this.deps;

    await database.client.loginThrottle.createMany({
      data: [{ key, failures: 0, windowStartedAt: now }],
      skipDuplicates: true,
    });

    const rows = await database.client.$queryRaw<RawLoginThrottleRow[]>`
      SELECT key, failures, window_started_at, blocked_until
      FROM identity.login_throttles
      WHERE key = ${key}
      FOR UPDATE
    `;
    const row = rows[0];
    // El createMany de arriba garantiza que la fila existe antes de este SELECT.
    if (!row) throw new Error(`No se pudo bloquear el throttle de login «${key}»`);

    return LoginThrottleMapper.toDomain({
      key: row.key,
      failures: row.failures,
      windowStartedAt: row.window_started_at,
      blockedUntil: row.blocked_until,
    });
  }

  async save(throttle: LoginThrottle): Promise<void> {
    const data = LoginThrottleMapper.toPersistence(throttle);
    await this.deps.database.client.loginThrottle.upsert({
      where: { key: data.key },
      create: data,
      update: data,
    });
  }
}
