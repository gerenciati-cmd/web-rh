import { asClass, asFunction } from 'awilix';

import type { Env } from '@/config/env';
import type { AppModule } from '@/shared/app-module';
import type { RequestAuthenticator } from '@/shared/application/actor';

import { LogIn } from './application/commands/log-in.command';
import { LogOut } from './application/commands/log-out.command';
import { RegisterUser } from './application/commands/register-user.command';
import type { PasswordHasher } from './application/ports/password-hasher';
import type { SessionTokens } from './application/ports/session-tokens';
import { GetCurrentUser } from './application/queries/get-current-user.query';
import type { UserQueries } from './application/queries/user.queries';
import { SessionAuthenticator } from './application/session-authenticator';
import type { LoginThrottlePolicy } from './domain/login-throttle';
import type { LoginThrottleRepository } from './domain/login-throttle.repository';
import type { SessionPolicy } from './domain/session';
import type { SessionRepository } from './domain/session.repository';
import type { UserRepository } from './domain/user.repository';
import { createIdentityRouter } from './http/identity.router';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { CryptoSessionTokens } from './infrastructure/crypto-session-tokens';
import { PrismaLoginThrottleRepository } from './infrastructure/prisma-login-throttle.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaUserQueries } from './infrastructure/prisma-user.queries';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';

export interface IdentityCradle {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  loginThrottleRepository: LoginThrottleRepository;
  userQueries: UserQueries;
  passwordHasher: PasswordHasher;
  sessionTokens: SessionTokens;
  sessionPolicy: SessionPolicy;
  loginThrottlePolicy: LoginThrottlePolicy;
  registerUser: RegisterUser;
  logIn: LogIn;
  logOut: LogOut;
  getCurrentUser: GetCurrentUser;
  requestAuthenticator: RequestAuthenticator;
}

export const identityModule: AppModule<IdentityCradle> = {
  name: 'identity',
  registrations: {
    userRepository: asClass(PrismaUserRepository).singleton(),
    sessionRepository: asClass(PrismaSessionRepository).singleton(),
    loginThrottleRepository: asClass(PrismaLoginThrottleRepository).singleton(),
    userQueries: asClass(PrismaUserQueries).singleton(),
    passwordHasher: asClass(Argon2PasswordHasher).singleton(),
    sessionTokens: asClass(CryptoSessionTokens).singleton(),
    sessionPolicy: asFunction(({ env }: { env: Env }) => ({
      WEB: {
        absoluteMs: env.SESSION_WEB_ABSOLUTE_HOURS * 3_600_000,
        idleMs: env.SESSION_WEB_IDLE_MINUTES * 60_000,
      },
      MOBILE: {
        absoluteMs: env.SESSION_MOBILE_ABSOLUTE_DAYS * 86_400_000,
        idleMs: null,
      },
    })).singleton(),
    loginThrottlePolicy: asFunction(({ env }: { env: Env }) => ({
      maxFailures: env.LOGIN_MAX_FAILURES,
      windowMs: env.LOGIN_FAILURE_WINDOW_MINUTES * 60_000,
      blockMs: env.LOGIN_BLOCK_MINUTES * 60_000,
    })).singleton(),
    registerUser: asClass(RegisterUser).singleton(),
    logIn: asClass(LogIn).singleton(),
    logOut: asClass(LogOut).singleton(),
    getCurrentUser: asClass(GetCurrentUser).singleton(),
    requestAuthenticator: asClass(SessionAuthenticator).singleton(),
  },
  router: createIdentityRouter,
};
