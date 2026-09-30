import type { Role } from '@rrhh/domain';
import { asValue } from 'awilix';

import { loadEnv, type Env } from '@/config/env';
import { buildContainer } from '@/container';
import { createApp } from '@/http/app';
import { createLogger } from '@/infrastructure/logging/pino-logger';
import type { EmployeeQueries } from '@/modules/employees/application/queries/employee.queries';
import { InMemoryEmployeeRepository } from '@/modules/employees/infrastructure/in-memory/in-memory-employee.repository';
import type { CompanyDirectory } from '@/modules/identity/application/ports/company-directory';
import { FakePasswordHasher } from '@/modules/identity/infrastructure/in-memory/fake-password-hasher';
import { InMemoryLoginThrottleRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-login-throttle.repository';
import { InMemoryRoleAssignmentRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-role-assignment.repository';
import { InMemorySessionRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-session.repository';
import { InMemoryUserQueries } from '@/modules/identity/infrastructure/in-memory/in-memory-user.queries';
import { InMemoryUserRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-user.repository';
import {
  InMemoryCompanyQueries,
  InMemoryCompanyRepository,
  InMemoryCompanyStore,
} from '@/modules/organization/infrastructure/in-memory/in-memory-company.store';
import type { TransactionRunner } from '@/shared/application/ports';

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
            email: s.email.value,
            positionTitle: s.positionTitle,
            hireDate: s.hireDate.toISOString().slice(0, 10),
            status: s.status,
          };
        });
      return Promise.resolve({ items, total: items.length, page, pageSize });
    },
  };

  container.register({
    companyRepository: asValue(new InMemoryCompanyRepository(companies)),
    companyQueries: asValue(new InMemoryCompanyQueries(companies)),
    employeeRepository: asValue(employees),
    employeeQueries: asValue(employeeQueries),
    userRepository: asValue(users),
    sessionRepository: asValue(new InMemorySessionRepository()),
    loginThrottleRepository: asValue(new InMemoryLoginThrottleRepository()),
    roleAssignmentRepository: asValue(roleAssignments),
    companyDirectory: asValue(companyDirectory),
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
