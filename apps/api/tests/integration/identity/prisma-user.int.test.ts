import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { PrismaTransactionRunner } from '@/infrastructure/database/prisma-transaction-runner';
import {
  EmployeeAlreadyLinkedError,
  UserAlreadyExistsError,
} from '@/modules/identity/domain/errors';
import { User, type UserId } from '@/modules/identity/domain/user';
import { PrismaUserRepository } from '@/modules/identity/infrastructure/prisma-user.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['identity.sessions', 'identity.users']);
const repository = new PrismaUserRepository({ database });
const ids = new SequentialIdGenerator();
const NOW = new Date('2026-01-15T12:00:00Z');

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

function user(rawEmail: string): User {
  return User.register({
    id: ids.next() as UserId,
    email: mustEmail(rawEmail),
    passwordHash: 'hash-de-prueba',
    now: NOW,
  });
}

describe('PrismaUserRepository', () => {
  it('guarda y rehidrata el usuario con el correo normalizado y el hash intactos', async () => {
    const ana = user('Ana@APS.cl');
    const saved = await repository.save(ana);
    expect(saved.ok).toBe(true);

    const found = await repository.findById(ana.id);

    expect(found?.snapshot.email.value).toBe('ana@aps.cl');
    expect(found?.snapshot.passwordHash).toBe('hash-de-prueba');
    expect(found?.snapshot.status).toBe('ACTIVE');
  });

  it('findById devuelve null para un id inexistente', async () => {
    expect(await repository.findById('00000000-0000-4000-8000-000000000000' as UserId)).toBeNull();
  });

  it('findByEmail encuentra por correo y devuelve null si no existe', async () => {
    const ana = user('busca@aps.cl');
    await repository.save(ana);

    expect((await repository.findByEmail(mustEmail('busca@aps.cl')))?.id).toBe(ana.id);
    expect(await repository.findByEmail(mustEmail('nadie@aps.cl'))).toBeNull();
  });

  it('traduce la violación del índice único de correo (carrera) al conflicto de dominio', async () => {
    await repository.save(user('dup@aps.cl'));

    const result = await repository.save(user('dup@aps.cl'));

    expect(result).toMatchObject({ ok: false, error: expect.any(UserAlreadyExistsError) });
  });

  describe('vínculo con el colaborador (employee_id)', () => {
    const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';

    function linked(rawEmail: string, employeeId: string | null): User {
      return User.register({
        id: ids.next() as UserId,
        email: mustEmail(rawEmail),
        passwordHash: 'hash-de-prueba',
        employeeId,
        now: NOW,
      });
    }

    it('guarda y rehidrata employeeId; sin vínculo queda null', async () => {
      const withLink = linked('vinculado@aps.cl', EMPLOYEE);
      const external = linked('externo@aps.cl', null);
      await repository.save(withLink);
      await repository.save(external);

      expect((await repository.findById(withLink.id))?.snapshot.employeeId).toBe(EMPLOYEE);
      expect((await repository.findById(external.id))?.snapshot.employeeId).toBeNull();
    });

    it('findByEmployeeId encuentra al usuario vinculado y devuelve null si no hay', async () => {
      const withLink = linked('vinculado@aps.cl', EMPLOYEE);
      await repository.save(withLink);

      expect((await repository.findByEmployeeId(EMPLOYEE))?.id).toBe(withLink.id);
      expect(await repository.findByEmployeeId('00000000-0000-4000-8000-0000000000e2')).toBeNull();
    });

    it('dos usuarios sin vínculo (null) conviven: el índice único no cuenta los null', async () => {
      const first = await repository.save(linked('uno@aps.cl', null));
      const second = await repository.save(linked('dos@aps.cl', null));

      expect(first.ok && second.ok).toBe(true);
    });

    // Riesgo declarado en el plan (Deviations): el repositorio distingue el índice de employee_id
    // del de email buscando `employee_id` en `meta` del P2002 (Prisma 7 + adapter-pg).
    it('dos usuarios con el mismo colaborador: EMPLOYEE_ALREADY_HAS_ACCESS (no USER_ALREADY_EXISTS)', async () => {
      await repository.save(linked('primero@aps.cl', EMPLOYEE));

      const result = await repository.save(linked('segundo@aps.cl', EMPLOYEE));

      expect(result).toMatchObject({ ok: false, error: expect.any(EmployeeAlreadyLinkedError) });
    });

    it('mismo correo y colaborador distinto sigue siendo USER_ALREADY_EXISTS', async () => {
      await repository.save(linked('mismo@aps.cl', EMPLOYEE));

      const result = await repository.save(
        linked('mismo@aps.cl', '00000000-0000-4000-8000-0000000000e2'),
      );

      expect(result).toMatchObject({ ok: false, error: expect.any(UserAlreadyExistsError) });
    });

    it('disable persiste el estado DISABLED y conserva el vínculo', async () => {
      const user = linked('baja@aps.cl', EMPLOYEE);
      await repository.save(user);

      user.disable(NOW);
      await repository.save(user);

      const found = await repository.findById(user.id);
      expect(found?.snapshot).toMatchObject({ status: 'DISABLED', employeeId: EMPLOYEE });
    });
  });

  it('save vuelve a guardar (upsert) y refleja el nuevo estado', async () => {
    const ana = user('estado@aps.cl');
    await repository.save(ana);

    const disabled = User.restore(ana.id, { ...ana.snapshot, status: 'DISABLED' });
    await repository.save(disabled);

    expect((await repository.findById(ana.id))?.snapshot.status).toBe('DISABLED');
  });

  it('changePassword persiste el hash nuevo y conserva el resto del usuario', async () => {
    const ana = user('cambia@aps.cl');
    await repository.save(ana);

    ana.changePassword('hash-nuevo', NOW);
    await repository.save(ana);

    const found = await repository.findById(ana.id);
    expect(found?.snapshot).toMatchObject({
      passwordHash: 'hash-nuevo',
      status: 'ACTIVE',
      employeeId: null,
    });
    expect(found?.snapshot.email.value).toBe('cambia@aps.cl');
  });
});

// `lock` debe llamarse dentro de `transactionRunner.run`: fuera de una transacción el
// `SELECT … FOR UPDATE` suelta el lock de inmediato.
describe('PrismaUserRepository.lock', () => {
  const transactionRunner = new PrismaTransactionRunner({ database });

  /** Espera (sin dormir un tiempo fijo) a que alguna sesión quede esperando un lock de fila. */
  async function waitForBlockedSession(): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await database.client.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_locks
        WHERE NOT granted AND locktype IN ('transactionid', 'tuple')
      `;
      if ((rows[0]?.waiting ?? 0) > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('ninguna transacción quedó esperando el lock');
  }

  it('devuelve true si el usuario existe y false si no', async () => {
    const ana = user('lock@aps.cl');
    await repository.save(ana);

    const existing = await transactionRunner.run(() => repository.lock(ana.id));
    const missing = await transactionRunner.run(() =>
      repository.lock('00000000-0000-4000-8000-00000000dead' as UserId),
    );

    expect(existing).toBe(true);
    expect(missing).toBe(false);
  });

  it('una segunda transacción espera a que la primera termine antes de obtener el lock', async () => {
    const ana = user('espera@aps.cl');
    await repository.save(ana);
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired!: () => void;
    const holding = new Promise<void>((resolve) => {
      acquired = resolve;
    });

    const first = transactionRunner.run(async () => {
      await repository.lock(ana.id);
      acquired();
      await gate;
      order.push('primera-termina');
    });
    await holding;
    const second = transactionRunner.run(async () => {
      await repository.lock(ana.id);
      order.push('segunda-bloquea');
    });
    await waitForBlockedSession();
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);

    expect(order).toEqual(['primera-termina', 'segunda-bloquea']);
  });

  it('la relectura tras el lock ve la baja confirmada por la transacción que lo tenía (no se pisa DISABLED)', async () => {
    const ana = user('baja-carrera@aps.cl');
    await repository.save(ana);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let acquired!: () => void;
    const holding = new Promise<void>((resolve) => {
      acquired = resolve;
    });

    const disabling = transactionRunner.run(async () => {
      await repository.lock(ana.id);
      const current = await repository.findById(ana.id);
      current?.disable(NOW);
      if (current) await repository.save(current);
      acquired();
      await gate;
    });
    await holding;
    const confirming = transactionRunner.run(async () => {
      await repository.lock(ana.id);
      return (await repository.findById(ana.id))?.snapshot.status;
    });
    await waitForBlockedSession();
    release();
    const [, seen] = await Promise.all([disabling, confirming]);

    expect(seen).toBe('DISABLED');
  });
});
