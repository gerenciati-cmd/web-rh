import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { UserAlreadyExistsError } from '@/modules/identity/domain/errors';
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

  it('save vuelve a guardar (upsert) y refleja el nuevo estado', async () => {
    const ana = user('estado@aps.cl');
    await repository.save(ana);

    const disabled = User.restore(ana.id, { ...ana.snapshot, status: 'DISABLED' });
    await repository.save(disabled);

    expect((await repository.findById(ana.id))?.snapshot.status).toBe('DISABLED');
  });
});
