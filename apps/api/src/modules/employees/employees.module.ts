import { asClass } from 'awilix';

import type { AppModule } from '@/shared/app-module';

import { AssignEmployeeRfc } from './application/commands/assign-employee-rfc.command';
import { RegisterEmployee } from './application/commands/register-employee.command';
import { EmployeesFacade, type EmployeesApi } from './application/employees.facade';
import type { EmployerDirectory } from './application/ports/employer-directory';
import type { EmployeeQueries } from './application/queries/employee.queries';
import { ListEmployees } from './application/queries/list-employees.query';
import type { EmployeeRepository } from './domain/employee.repository';
import { createEmployeesRouter } from './http/employees.router';
import { OrganizationEmployerDirectory } from './infrastructure/organization-employer-directory';
import { PrismaEmployeeQueries } from './infrastructure/prisma-employee.queries';
import { PrismaEmployeeRepository } from './infrastructure/prisma-employee.repository';

export interface EmployeesCradle {
  employeeRepository: EmployeeRepository;
  employeeQueries: EmployeeQueries;
  employerDirectory: EmployerDirectory;
  employeesApi: EmployeesApi;
  registerEmployee: RegisterEmployee;
  assignEmployeeRfc: AssignEmployeeRfc;
  listEmployees: ListEmployees;
}

export const employeesModule: AppModule<EmployeesCradle> = {
  name: 'employees',
  registrations: {
    employeeRepository: asClass(PrismaEmployeeRepository).singleton(),
    employeeQueries: asClass(PrismaEmployeeQueries).singleton(),
    employerDirectory: asClass(OrganizationEmployerDirectory).singleton(),
    employeesApi: asClass(EmployeesFacade).singleton(),
    registerEmployee: asClass(RegisterEmployee).singleton(),
    assignEmployeeRfc: asClass(AssignEmployeeRfc).singleton(),
    listEmployees: asClass(ListEmployees).singleton(),
  },
  router: createEmployeesRouter,
};
