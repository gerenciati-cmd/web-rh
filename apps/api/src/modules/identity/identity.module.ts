import { asClass, asFunction } from 'awilix';
import { Router } from 'express';

import type { Env } from '@/config/env';
import type { AppModule } from '@/shared/app-module';
import type { RequestAuthenticator } from '@/shared/application/actor';

import { AssignRole } from './application/commands/assign-role.command';
import { LogIn } from './application/commands/log-in.command';
import { LogOut } from './application/commands/log-out.command';
import { RegisterUser } from './application/commands/register-user.command';
import { RevokeRoleAssignment } from './application/commands/revoke-role-assignment.command';
import type { CompanyDirectory } from './application/ports/company-directory';
import type { PasswordHasher } from './application/ports/password-hasher';
import type { SessionTokens } from './application/ports/session-tokens';
import { GetCurrentUser } from './application/queries/get-current-user.query';
import { ListRoleAssignments } from './application/queries/list-role-assignments.query';
import { ListUsers } from './application/queries/list-users.query';
import type { UserQueries } from './application/queries/user.queries';
import { SessionAuthenticator } from './application/session-authenticator';
import type { LoginThrottlePolicies } from './domain/login-throttle';
import type { LoginThrottleRepository } from './domain/login-throttle.repository';
import type { RoleAssignmentRepository } from './domain/role-assignment.repository';
import type { SessionPolicy } from './domain/session';
import type { SessionRepository } from './domain/session.repository';
import type { UserRepository } from './domain/user.repository';
import { createAccessRouter } from './http/access.router';
import { createIdentityRouter } from './http/identity.router';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { CryptoSessionTokens } from './infrastructure/crypto-session-tokens';
import { OrganizationCompanyDirectory } from './infrastructure/organization-company-directory';
import { PrismaLoginThrottleRepository } from './infrastructure/prisma-login-throttle.repository';
import { PrismaRoleAssignmentRepository } from './infrastructure/prisma-role-assignment.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaUserQueries } from './infrastructure/prisma-user.queries';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';

export interface IdentityCradle {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  loginThrottleRepository: LoginThrottleRepository;
  roleAssignmentRepository: RoleAssignmentRepository;
  companyDirectory: CompanyDirectory;
  userQueries: UserQueries;
  passwordHasher: PasswordHasher;
  sessionTokens: SessionTokens;
  sessionPolicy: SessionPolicy;
  loginThrottlePolicies: LoginThrottlePolicies;
  registerUser: RegisterUser;
  logIn: LogIn;
  logOut: LogOut;
  getCurrentUser: GetCurrentUser;
  listUsers: ListUsers;
  listRoleAssignments: ListRoleAssignments;
  assignRole: AssignRole;
  revokeRoleAssignment: RevokeRoleAssignment;
  requestAuthenticator: RequestAuthenticator;
}

export const identityModule: AppModule<IdentityCradle> = {
  name: 'identity',
  registrations: {
    userRepository: asClass(PrismaUserRepository).singleton(),
    sessionRepository: asClass(PrismaSessionRepository).singleton(),
    loginThrottleRepository: asClass(PrismaLoginThrottleRepository).singleton(),
    roleAssignmentRepository: asClass(PrismaRoleAssignmentRepository).singleton(),
    companyDirectory: asClass(OrganizationCompanyDirectory).singleton(),
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
    // M2: la IP tiene su propio límite (LOGIN_IP_MAX_FAILURES), separado del de correo — ver
    // README decisión 12.
    loginThrottlePolicies: asFunction(({ env }: { env: Env }) => ({
      email: {
        maxFailures: env.LOGIN_MAX_FAILURES,
        windowMs: env.LOGIN_FAILURE_WINDOW_MINUTES * 60_000,
        blockMs: env.LOGIN_BLOCK_MINUTES * 60_000,
      },
      ip: {
        maxFailures: env.LOGIN_IP_MAX_FAILURES,
        windowMs: env.LOGIN_FAILURE_WINDOW_MINUTES * 60_000,
        blockMs: env.LOGIN_BLOCK_MINUTES * 60_000,
      },
    })).singleton(),
    registerUser: asClass(RegisterUser).singleton(),
    logIn: asClass(LogIn).singleton(),
    logOut: asClass(LogOut).singleton(),
    getCurrentUser: asClass(GetCurrentUser).singleton(),
    listUsers: asClass(ListUsers).singleton(),
    listRoleAssignments: asClass(ListRoleAssignments).singleton(),
    assignRole: asClass(AssignRole).singleton(),
    revokeRoleAssignment: asClass(RevokeRoleAssignment).singleton(),
    requestAuthenticator: asClass(SessionAuthenticator).singleton(),
  },
  // `AppModule.router` es una sola función: un router que monta autenticación y accesos.
  router: (cradle) => {
    const router = Router();
    router.use(createIdentityRouter(cradle));
    router.use(createAccessRouter(cradle));
    return router;
  },
};
