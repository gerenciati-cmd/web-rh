import type { Role } from '@rrhh/domain';
import { asValue } from 'awilix';

import { loadEnv, type Env } from '@/config/env';
import { buildContainer } from '@/container';
import { createApp } from '@/http/app';
import { createLogger } from '@/infrastructure/logging/pino-logger';
import {
  InMemoryAttendanceQueries,
  InMemoryAttendanceStore,
  InMemoryDeviceCommandRepository,
  InMemoryDeviceRepository,
  InMemoryPunchRepository,
} from '@/modules/attendance/infrastructure/in-memory/in-memory-attendance.store';
import type { EmployeeQueries } from '@/modules/employees/application/queries/employee.queries';
import { InMemoryEmployeeRepository } from '@/modules/employees/infrastructure/in-memory/in-memory-employee.repository';
import type { CompanyDirectory } from '@/modules/identity/application/ports/company-directory';
import type { EmployeeDirectory } from '@/modules/identity/application/ports/employee-directory';
import { FakePasswordHasher } from '@/modules/identity/infrastructure/in-memory/fake-password-hasher';
import { InMemoryInvitationRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-invitation.repository';
import { InMemoryLoginThrottleRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-login-throttle.repository';
import { InMemoryPasswordResetRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-password-reset.repository';
import { InMemoryRoleAssignmentRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-role-assignment.repository';
import { InMemorySessionRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-session.repository';
import { InMemoryUserQueries } from '@/modules/identity/infrastructure/in-memory/in-memory-user.queries';
import { InMemoryUserRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-user.repository';
import {
  InMemoryCompanyQueries,
  InMemoryCompanyRepository,
  InMemoryCompanyStore,
} from '@/modules/organization/infrastructure/in-memory/in-memory-company.store';
import {
  InMemorySiteQueries,
  InMemorySiteRepository,
  InMemorySiteStore,
} from '@/modules/organization/infrastructure/in-memory/in-memory-site.store';
import type { TransactionRunner } from '@/shared/application/ports';
import { RecordingEmailSender, RecordingJobQueue } from '@/shared/testing/fakes';

/**
 * `LogIn` (plan 001, paso 15/H3) usa `transactionRunner` para el row lock del throttle de login;
 * el real abre una transacción de Postgres de verdad, que aquí no hay (persistencia en memoria
 * para el resto del contenedor de test), así que se reemplaza por un no-op.
 */
class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

export const testEnv = loadEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
});

/** Contenedor real con los adaptadores de persistencia reemplazados por memoria. */
export function buildTestContainer(env: Env = testEnv) {
  const container = buildContainer(env, createLogger(env));
  const companies = new InMemoryCompanyStore();
  const sites = new InMemorySiteStore();
  const attendance = new InMemoryAttendanceStore();
  const employees = new InMemoryEmployeeRepository();
  const users = new InMemoryUserRepository();
  const roleAssignments = new InMemoryRoleAssignmentRepository({ userRepository: users });
  // Directorio falso respaldado por el mismo almacén de empresas del contenedor de test.
  const companyDirectory: CompanyDirectory = {
    find: (companyId) => {
      const company = companies.companies.get(companyId);
      return Promise.resolve(company ? { id: company.id, active: company.active } : null);
    },
  };

  // Directorio falso respaldado por el mismo almacén de colaboradores del contenedor de test.
  const employeeDirectory: EmployeeDirectory = {
    find: (employeeId) => {
      const employee = employees.employees.get(employeeId);
      if (!employee) return Promise.resolve(null);
      const s = employee.snapshot;
      return Promise.resolve({
        id: employee.id,
        companyId: s.companyId,
        email: s.email.value,
        fullName: `${s.firstName} ${s.lastName}`,
        active: s.status === 'ACTIVE',
      });
    },
  };

  const employeeQueries: EmployeeQueries = {
    listDirectory: ({ companyId, page, pageSize }) => {
      const items = [...employees.employees.values()]
        .filter((employee) => employee.snapshot.companyId === companyId)
        .map((employee) => {
          const s = employee.snapshot;
          return {
            id: employee.id,
            fullName: `${s.firstName} ${s.lastName}`,
            nationalId: s.nationalId.format(),
            rfc: s.rfc?.value ?? null,
            siteId: s.siteId,
            email: s.email.value,
            positionTitle: s.positionTitle,
            hireDate: s.hireDate.toISOString().slice(0, 10),
            status: s.status,
          };
        });
      return Promise.resolve({ items, total: items.length, page, pageSize });
    },
    findByRfcs: (rfcs) =>
      Promise.resolve(
        [...employees.employees.values()].flatMap((employee) => {
          const s = employee.snapshot;
          if (!s.rfc || !rfcs.includes(s.rfc.value)) return [];
          return [
            {
              id: employee.id,
              companyId: s.companyId,
              fullName: `${s.firstName} ${s.lastName}`,
              rfc: s.rfc.value,
              active: s.status === 'ACTIVE',
            },
          ];
        }),
      ),
    rfcsInCompanies: (companyIds) =>
      Promise.resolve(
        [...employees.employees.values()].flatMap((employee) => {
          const s = employee.snapshot;
          return s.rfc && companyIds.includes(s.companyId) ? [s.rfc.value] : [];
        }),
      ),
    listActiveOnSite: (siteId) =>
      Promise.resolve(
        [...employees.employees.values()].flatMap((employee) => {
          const s = employee.snapshot;
          if (s.siteId !== siteId || s.status !== 'ACTIVE') return [];
          return [
            {
              id: employee.id,
              companyId: s.companyId,
              fullName: `${s.firstName} ${s.lastName}`,
              rfc: s.rfc?.value ?? null,
            },
          ];
        }),
      ),
  };

  container.register({
    companyRepository: asValue(new InMemoryCompanyRepository(companies)),
    companyQueries: asValue(new InMemoryCompanyQueries(companies)),
    siteRepository: asValue(new InMemorySiteRepository(sites)),
    siteQueries: asValue(new InMemorySiteQueries(sites)),
    employeeRepository: asValue(employees),
    employeeQueries: asValue(employeeQueries),
    deviceRepository: asValue(new InMemoryDeviceRepository(attendance)),
    punchRepository: asValue(new InMemoryPunchRepository(attendance)),
    deviceCommandRepository: asValue(new InMemoryDeviceCommandRepository(attendance)),
    attendanceQueries: asValue(new InMemoryAttendanceQueries(attendance)),
    userRepository: asValue(users),
    sessionRepository: asValue(new InMemorySessionRepository()),
    loginThrottleRepository: asValue(new InMemoryLoginThrottleRepository()),
    roleAssignmentRepository: asValue(roleAssignments),
    companyDirectory: asValue(companyDirectory),
    employeeDirectory: asValue(employeeDirectory),
    invitationRepository: asValue(new InMemoryInvitationRepository()),
    passwordResetRepository: asValue(new InMemoryPasswordResetRepository()),
    // Sin Valkey ni SMTP: los tests inspeccionan lo encolado y lo enviado.
    jobQueue: asValue(new RecordingJobQueue()),
    emailSender: asValue(new RecordingEmailSender()),
    userQueries: asValue(
      new InMemoryUserQueries({ userRepository: users, roleAssignmentRepository: roleAssignments }),
    ),
    passwordHasher: asValue(new FakePasswordHasher()),
    transactionRunner: asValue(new NoopTransactionRunner()),
  });

  return container;
}

export function buildTestApp() {
  return createApp(buildTestContainer());
}

let siteCounter = 0;

/** Crea una sede MX activa (`America/Cancun`) y devuelve su id; el nombre por defecto es único. */
export async function createTestSite(
  container: ReturnType<typeof buildTestContainer>,
  name?: string,
): Promise<string> {
  siteCounter += 1;
  const created = await container.cradle.createSite.execute({
    name: name ?? `Sede de prueba ${siteCounter}`,
    country: 'MX',
    timeZone: 'America/Cancun',
  });
  if (!created.ok) throw created.error;
  return created.value.id;
}

const SIGN_IN_PASSWORD = 'contraseña-larga-y-valida';
let signInCounter = 0;

/**
 * Registra un usuario nuevo, le asigna `role` (con `assignedBy: null`, como el seed) y abre una
 * sesión móvil: devuelve el token para `Authorization: Bearer`.
 */
export async function signInAs(
  container: ReturnType<typeof buildTestContainer>,
  options: { role: Role; companyId?: string },
): Promise<string> {
  const { registerUser, assignRole, logIn } = container.cradle;
  signInCounter += 1;
  const email = `usuario${signInCounter}@example.com`;

  const registered = await registerUser.execute({ email, password: SIGN_IN_PASSWORD });
  if (!registered.ok) throw registered.error;
  const assigned = await assignRole.execute({
    userId: registered.value.id,
    role: options.role,
    companyId: options.companyId ?? null,
    assignedBy: null,
  });
  if (!assigned.ok) throw assigned.error;

  const session = await logIn.execute({
    email,
    password: SIGN_IN_PASSWORD,
    client: 'mobile',
    ip: null,
    userAgent: null,
  });
  if (!session.ok) throw session.error;
  return session.value.token;
}
