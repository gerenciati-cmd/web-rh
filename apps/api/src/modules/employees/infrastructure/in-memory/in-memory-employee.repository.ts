import { err, ok, type NationalId, type PersonalRfc, type Result } from '@rrhh/domain';

import type { Employee, EmployeeId } from '../../domain/employee';
import type { EmployeeRepository } from '../../domain/employee.repository';
import { EmployeeAlreadyExistsError, EmployeeRfcAlreadyRegisteredError } from '../../domain/errors';

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

  existsByRfc(rfc: PersonalRfc, exceptId?: EmployeeId): Promise<boolean> {
    const exists = [...this.employees.values()].some(
      (e) => e.id !== exceptId && e.snapshot.rfc?.equals(rfc) === true,
    );
    return Promise.resolve(exists);
  }

  save(
    employee: Employee,
  ): Promise<Result<void, EmployeeAlreadyExistsError | EmployeeRfcAlreadyRegisteredError>> {
    const others = [...this.employees.values()].filter((other) => other.id !== employee.id);
    const { rfc } = employee.snapshot;
    // Mismo orden que el comando: el CURP duplicado en la empresa gana sobre el RFC duplicado.
    const duplicate = others.some(
      (other) =>
        other.snapshot.companyId === employee.snapshot.companyId &&
        other.snapshot.nationalId.equals(employee.snapshot.nationalId),
    );
    if (duplicate)
      return Promise.resolve(
        err(new EmployeeAlreadyExistsError(employee.snapshot.nationalId.format())),
      );
    if (rfc && others.some((other) => other.snapshot.rfc?.equals(rfc) === true)) {
      return Promise.resolve(err(new EmployeeRfcAlreadyRegisteredError(rfc.value)));
    }
    this.employees.set(employee.id, employee);
    return Promise.resolve(ok(undefined));
  }
}
