/** API PÚBLICA del módulo employees. */
export type { EmployeeSummary, EmployeesApi } from './application/employees.facade';
export { EMPLOYEE_HIRED, EMPLOYEE_TERMINATED } from './domain/employee';
export { employeesModule, type EmployeesCradle } from './employees.module';
