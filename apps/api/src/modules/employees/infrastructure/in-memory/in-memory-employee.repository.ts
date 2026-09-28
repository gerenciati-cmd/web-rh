import { err, ok, type NationalId, type Result } from '@rrhh/domain';

import type { Employee, EmployeeId } from '../../domain/employee';
import type { EmployeeRepository } from '../../domain/employee.repository';
import { EmployeeAlreadyExistsError } from '../../domain/errors';

export class InMemoryEmployeeRepository implements EmployeeRepository {
  readonly employees = new Map<string, Employee>();

  findById(id: EmployeeId): Promise<Employee | null> {
    return Promise.resolve(this.employees.get(id) ?? null);
  }

  existsInCompany(companyId: string, nationalId: NationalId): Promise<boolean> {
    const exists = [...this.employees.values()].some(
      (e) => e.snapshot.companyId === companyId && e.snapshot.nationalId.equals(nationalId),
    );
    return Promise.resolve(exists);
  }

  save(employee: Employee): Promise<Result<void, EmployeeAlreadyExistsError>> {
    const duplicate = [...this.employees.values()].some(
      (other) =>
        other.id !== employee.id &&
        other.snapshot.companyId === employee.snapshot.companyId &&
        other.snapshot.nationalId.equals(employee.snapshot.nationalId),
    );
    if (duplicate)
      return Promise.resolve(
        err(new EmployeeAlreadyExistsError(employee.snapshot.nationalId.format())),
      );
    this.employees.set(employee.id, employee);
    return Promise.resolve(ok(undefined));
  }
}
