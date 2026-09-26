import { asValue } from 'awilix';

import { loadEnv } from '@/config/env';
import { buildContainer } from '@/container';
import { createApp } from '@/http/app';
import { createLogger } from '@/infrastructure/logging/pino-logger';
import type { EmployeeQueries } from '@/modules/employees/application/queries/employee.queries';
import { InMemoryEmployeeRepository } from '@/modules/employees/infrastructure/in-memory/in-memory-employee.repository';
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
export function buildTestContainer() {
  const container = buildContainer(testEnv, createLogger(testEnv));
  const companies = new InMemoryCompanyStore();
  const employees = new InMemoryEmployeeRepository();

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
  });

  return container;
}

export function buildTestApp() {
  return createApp(buildTestContainer());
}
