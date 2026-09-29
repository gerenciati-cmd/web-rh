import { Email, err, ok } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { UserAlreadyExistsError } from '../../domain/errors';
import { checkPasswordPolicy } from '../../domain/password-policy';
import { User, type UserId } from '../../domain/user';
import type { UserRepository } from '../../domain/user.repository';
import type { PasswordHasher } from '../ports/password-hasher';

export interface RegisterUserInput {
  email: string;
  password: string;
}

interface Deps {
  userRepository: UserRepository;
  passwordHasher: PasswordHasher;
  idGenerator: IdGenerator;
  clock: Clock;
  eventBus: EventBus;
}

/** Alta de usuarios: hoy solo la usa el seed de desarrollo (README dependencia con plan 003). */
export class RegisterUser implements Command<RegisterUserInput, { id: UserId }> {
  constructor(private readonly deps: Deps) {}

  async execute(input: RegisterUserInput) {
    const { userRepository, passwordHasher, idGenerator, clock, eventBus } = this.deps;

    const email = Email.create(input.email);
    if (!email.ok) return email;

    const policy = checkPasswordPolicy(input.password);
    if (!policy.ok) return policy;

    const existing = await userRepository.findByEmail(email.value);
    if (existing) return err(new UserAlreadyExistsError());

    const passwordHash = await passwordHasher.hash(input.password);
    const user = User.register({
      id: idGenerator.next() as UserId,
      email: email.value,
      passwordHash,
      now: clock.now(),
    });

    const saved = await userRepository.save(user);
    if (!saved.ok) return saved;

    await eventBus.publish(user.pullEvents());
    return ok({ id: user.id });
  }
}
