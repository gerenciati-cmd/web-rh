import type { NationalId } from '@rrhh/domain';

import type { Employee, EmployeeId } from '../../domain/employee';
import type { EmployeeRepository } from '../../domain/employee.repository';

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

  save(employee: Employee): Promise<void> {
    this.employees.set(employee.id, employee);
    return Promise.resolve();
  }
}
