/** API PÚBLICA del módulo employees. */
export type { EmployeeSummary, EmployeesApi } from './application/employees.facade';
export type { EmployeeRfcOwner, SiteMember } from './application/queries/employee.queries';
export {
  EMPLOYEE_HIRED,
  EMPLOYEE_RFC_ASSIGNED,
  EMPLOYEE_SITE_ASSIGNED,
  EMPLOYEE_TERMINATED,
} from './domain/employee';
export { employeesModule, type EmployeesCradle } from './employees.module';
