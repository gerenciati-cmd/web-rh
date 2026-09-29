import { err } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { UserAlreadyExistsError } from '../../domain/errors';
import { PASSWORD_MIN_LENGTH } from '../../domain/password-policy';
import { USER_REGISTERED } from '../../domain/user';
import { FakePasswordHasher } from '../../infrastructure/in-memory/fake-password-hasher';
import { InMemoryUserRepository } from '../../infrastructure/in-memory/in-memory-user.repository';

import { RegisterUser, type RegisterUserInput } from './register-user.command';

describe('RegisterUser', () => {
  let repository: InMemoryUserRepository;
  let eventBus: RecordingEventBus;
  let hasher: FakePasswordHasher;
  let registerUser: RegisterUser;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
    eventBus = new RecordingEventBus();
    hasher = new FakePasswordHasher();
    registerUser = new RegisterUser({
      userRepository: repository,
      passwordHasher: hasher,
      idGenerator: new SequentialIdGenerator(),
      clock: new FixedClock(),
      eventBus,
    });
  });

  const input: RegisterUserInput = {
    email: 'Ana@APS.cl',
    password: 'a'.repeat(PASSWORD_MIN_LENGTH),
  };

  it('registra el usuario con el correo normalizado, el hash de la contraseña y publica USER_REGISTERED', async () => {
    const result = await registerUser.execute(input);

    expect(result.ok).toBe(true);
    expect(repository.users.size).toBe(1);
    const [saved] = [...repository.users.values()];
    expect(saved?.snapshot.email.value).toBe('ana@aps.cl');
    expect(saved?.snapshot.passwordHash).toBe(`fake:${input.password}`);
    expect(saved?.snapshot.status).toBe('ACTIVE');
    expect(eventBus.names()).toEqual([USER_REGISTERED]);
  });

  it('rechaza un correo inválido sin guardar nada', async () => {
    const result = await registerUser.execute({ ...input, email: 'no-es-email' });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
    expect(repository.users.size).toBe(0);
    expect(eventBus.names()).toEqual([]);
  });

  it('rechaza una contraseña más corta que el mínimo (WEAK_PASSWORD)', async () => {
    const result = await registerUser.execute({ ...input, password: 'corta' });

    expect(!result.ok && result.error.code).toBe('WEAK_PASSWORD');
    expect(repository.users.size).toBe(0);
  });

  it('rechaza un correo ya registrado (USER_ALREADY_EXISTS) sin volver a hashear', async () => {
    await registerUser.execute(input);
    const hashCallsBefore = repository.users.size;

    const result = await registerUser.execute(input);

    expect(!result.ok && result.error.code).toBe('USER_ALREADY_EXISTS');
    expect(repository.users.size).toBe(hashCallsBefore);
  });

  it('propaga el conflicto de save sin publicar evento (carrera)', async () => {
    vi.spyOn(repository, 'save').mockResolvedValue(err(new UserAlreadyExistsError()));

    const result = await registerUser.execute(input);

    expect(!result.ok && result.error.code).toBe('USER_ALREADY_EXISTS');
    expect(eventBus.names()).toEqual([]);
  });
});
