import { asValue } from 'awilix';

import { loadEnv, type Env } from '@/config/env';
import { buildContainer } from '@/container';
import { createApp } from '@/http/app';
import { createLogger } from '@/infrastructure/logging/pino-logger';
import type { EmployeeQueries } from '@/modules/employees/application/queries/employee.queries';
import { InMemoryEmployeeRepository } from '@/modules/employees/infrastructure/in-memory/in-memory-employee.repository';
import { FakePasswordHasher } from '@/modules/identity/infrastructure/in-memory/fake-password-hasher';
import { InMemoryLoginThrottleRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-login-throttle.repository';
import { InMemorySessionRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-session.repository';
import { InMemoryUserQueries } from '@/modules/identity/infrastructure/in-memory/in-memory-user.queries';
import { InMemoryUserRepository } from '@/modules/identity/infrastructure/in-memory/in-memory-user.repository';
import {
  InMemoryCompanyQueries,
  InMemoryCompanyRepository,
  InMemoryCompanyStore,
} from '@/modules/organization/infrastructure/in-memory/in-memory-company.store';

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
    userQueries: asValue(new InMemoryUserQueries({ userRepository: users })),
    passwordHasher: asValue(new FakePasswordHasher()),
  });

  return container;
}

export function buildTestApp() {
  return createApp(buildTestContainer());
}
