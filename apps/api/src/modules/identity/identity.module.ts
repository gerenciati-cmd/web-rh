import { asClass, asFunction } from 'awilix';
import { Router } from 'express';

import type { Env } from '@/config/env';
import { EMPLOYEE_TERMINATED } from '@/modules/employees';
import type { AppModule } from '@/shared/app-module';
import type { RequestAuthenticator } from '@/shared/application/actor';

import { ActivateAccount } from './application/commands/activate-account.command';
import { AssignRole } from './application/commands/assign-role.command';
import { DisableTerminatedEmployee } from './application/commands/disable-terminated-employee.command';
import { ForceEmployeePasswordReset } from './application/commands/force-employee-password-reset.command';
import { ForceUserPasswordReset } from './application/commands/force-user-password-reset.command';
import { InviteEmployee } from './application/commands/invite-employee.command';
import { InviteExternal } from './application/commands/invite-external.command';
import { LogIn } from './application/commands/log-in.command';
import { LogOut } from './application/commands/log-out.command';
import { RegisterUser } from './application/commands/register-user.command';
import { RequestPasswordReset } from './application/commands/request-password-reset.command';
import { ResetPassword } from './application/commands/reset-password.command';
import { RevokeRoleAssignment } from './application/commands/revoke-role-assignment.command';
import { SendInvitationEmail } from './application/jobs/send-invitation-email.job';
import { SendPasswordResetEmail } from './application/jobs/send-password-reset-email.job';
import { PasswordResetIssuer } from './application/password-reset-issuer';
import type { CompanyDirectory } from './application/ports/company-directory';
import type { EmployeeDirectory } from './application/ports/employee-directory';
import type { InvitationPolicy, InvitationTokens } from './application/ports/invitation-tokens';
import type { PasswordHasher } from './application/ports/password-hasher';
import type {
  PasswordResetPolicy,
  PasswordResetTokens,
} from './application/ports/password-reset-tokens';
import type { SessionTokens } from './application/ports/session-tokens';
import { GetCurrentUser } from './application/queries/get-current-user.query';
import { ListRoleAssignments } from './application/queries/list-role-assignments.query';
import { ListUsers } from './application/queries/list-users.query';
import type { UserQueries } from './application/queries/user.queries';
import { SessionAuthenticator } from './application/session-authenticator';
import type { InvitationRepository } from './domain/invitation.repository';
import type { LoginThrottlePolicies } from './domain/login-throttle';
import type { LoginThrottleRepository } from './domain/login-throttle.repository';
import type { PasswordResetRepository } from './domain/password-reset.repository';
import type { RoleAssignmentRepository } from './domain/role-assignment.repository';
import type { SessionPolicy } from './domain/session';
import type { SessionRepository } from './domain/session.repository';
import type { UserRepository } from './domain/user.repository';
import { createAccessRouter } from './http/access.router';
import { createIdentityRouter } from './http/identity.router';
import { createInvitationRouter } from './http/invitation.router';
import { createPasswordResetRouter } from './http/password-reset.router';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import { CryptoInvitationTokens } from './infrastructure/crypto-invitation-tokens';
import { CryptoPasswordResetTokens } from './infrastructure/crypto-password-reset-tokens';
import { CryptoSessionTokens } from './infrastructure/crypto-session-tokens';
import { EmployeesEmployeeDirectory } from './infrastructure/employees-employee-directory';
import { OrganizationCompanyDirectory } from './infrastructure/organization-company-directory';
import { PrismaInvitationRepository } from './infrastructure/prisma-invitation.repository';
import { PrismaLoginThrottleRepository } from './infrastructure/prisma-login-throttle.repository';
import { PrismaPasswordResetRepository } from './infrastructure/prisma-password-reset.repository';
import { PrismaRoleAssignmentRepository } from './infrastructure/prisma-role-assignment.repository';
import { PrismaSessionRepository } from './infrastructure/prisma-session.repository';
import { PrismaUserQueries } from './infrastructure/prisma-user.queries';
import { PrismaUserRepository } from './infrastructure/prisma-user.repository';

export interface IdentityCradle {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  loginThrottleRepository: LoginThrottleRepository;
  roleAssignmentRepository: RoleAssignmentRepository;
  invitationRepository: InvitationRepository;
  passwordResetRepository: PasswordResetRepository;
  companyDirectory: CompanyDirectory;
  employeeDirectory: EmployeeDirectory;
  userQueries: UserQueries;
  passwordHasher: PasswordHasher;
  sessionTokens: SessionTokens;
  invitationTokens: InvitationTokens;
  invitationPolicy: InvitationPolicy;
  passwordResetTokens: PasswordResetTokens;
  passwordResetPolicy: PasswordResetPolicy;
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
  inviteEmployee: InviteEmployee;
  inviteExternal: InviteExternal;
  activateAccount: ActivateAccount;
  disableTerminatedEmployee: DisableTerminatedEmployee;
  passwordResetIssuer: PasswordResetIssuer;
  requestPasswordReset: RequestPasswordReset;
  resetPassword: ResetPassword;
  forceEmployeePasswordReset: ForceEmployeePasswordReset;
  forceUserPasswordReset: ForceUserPasswordReset;
  sendInvitationEmail: SendInvitationEmail;
  sendPasswordResetEmail: SendPasswordResetEmail;
  requestAuthenticator: RequestAuthenticator;
}

export const identityModule: AppModule<IdentityCradle> = {
  name: 'identity',
  registrations: {
    userRepository: asClass(PrismaUserRepository).singleton(),
    sessionRepository: asClass(PrismaSessionRepository).singleton(),
    loginThrottleRepository: asClass(PrismaLoginThrottleRepository).singleton(),
    roleAssignmentRepository: asClass(PrismaRoleAssignmentRepository).singleton(),
    invitationRepository: asClass(PrismaInvitationRepository).singleton(),
    passwordResetRepository: asClass(PrismaPasswordResetRepository).singleton(),
    companyDirectory: asClass(OrganizationCompanyDirectory).singleton(),
    employeeDirectory: asClass(EmployeesEmployeeDirectory).singleton(),
    userQueries: asClass(PrismaUserQueries).singleton(),
    passwordHasher: asClass(Argon2PasswordHasher).singleton(),
    sessionTokens: asClass(CryptoSessionTokens).singleton(),
    invitationTokens: asClass(CryptoInvitationTokens).singleton(),
    invitationPolicy: asFunction(({ env }: { env: Env }) => ({
      ttlMs: env.INVITATION_TTL_HOURS * 3_600_000,
      appPublicUrl: env.APP_PUBLIC_URL.replace(/\/+$/, ''),
    })).singleton(),
    passwordResetTokens: asClass(CryptoPasswordResetTokens).singleton(),
    passwordResetPolicy: asFunction(({ env }: { env: Env }) => ({
      ttlMs: env.PASSWORD_RESET_TTL_MINUTES * 60_000,
      cooldownMs: env.PASSWORD_RESET_COOLDOWN_SECONDS * 1_000,
      appPublicUrl: env.APP_PUBLIC_URL.replace(/\/+$/, ''),
    })).singleton(),
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
    inviteEmployee: asClass(InviteEmployee).singleton(),
    inviteExternal: asClass(InviteExternal).singleton(),
    activateAccount: asClass(ActivateAccount).singleton(),
    disableTerminatedEmployee: asClass(DisableTerminatedEmployee).singleton(),
    passwordResetIssuer: asClass(PasswordResetIssuer).singleton(),
    requestPasswordReset: asClass(RequestPasswordReset).singleton(),
    resetPassword: asClass(ResetPassword).singleton(),
    forceEmployeePasswordReset: asClass(ForceEmployeePasswordReset).singleton(),
    forceUserPasswordReset: asClass(ForceUserPasswordReset).singleton(),
    sendInvitationEmail: asClass(SendInvitationEmail).singleton(),
    sendPasswordResetEmail: asClass(SendPasswordResetEmail).singleton(),
    requestAuthenticator: asClass(SessionAuthenticator).singleton(),
  },
  // `AppModule.router` es una sola función: un router que monta autenticación y accesos.
  router: (cradle) => {
    const router = Router();
    router.use(createIdentityRouter(cradle));
    router.use(createAccessRouter(cradle));
    router.use(createInvitationRouter(cradle));
    router.use(createPasswordResetRouter(cradle));
    return router;
  },
  // Primera suscripción entre módulos (ADR 0005): la baja de un colaborador cierra su acceso.
  subscribe: ({ eventBus, disableTerminatedEmployee }) => {
    eventBus.subscribe(EMPLOYEE_TERMINATED, async (event) => {
      const payload = event.payload as { employeeId?: unknown } | null;
      const employeeId = payload?.employeeId;
      // El bus registra el rechazo de un handler: una forma desconocida se loguea y se ignora.
      if (typeof employeeId !== 'string') {
        throw new Error(`El evento ${EMPLOYEE_TERMINATED} no trae un employeeId válido`);
      }
      await disableTerminatedEmployee.execute({ employeeId });
    });
  },
  jobs: ({ sendInvitationEmail, sendPasswordResetEmail }) => [
    sendInvitationEmail,
    sendPasswordResetEmail,
  ],
};
