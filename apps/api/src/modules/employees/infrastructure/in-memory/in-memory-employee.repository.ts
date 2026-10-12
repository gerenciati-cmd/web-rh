import {
  err,
  ok,
  type EmployeeStatus,
  type NationalId,
  type PersonalRfc,
  type Result,
} from '@rrhh/domain';

import type { Employee, EmployeeId } from '../../domain/employee';
import type { EmployeeRepository } from '../../domain/employee.repository';
import {
  EmployeeAlreadyExistsError,
  EmployeeAlreadyTerminatedError,
  EmployeeInactiveError,
  EmployeeRfcAlreadyRegisteredError,
} from '../../domain/errors';

export class InMemoryEmployeeRepository implements EmployeeRepository {
  readonly employees = new Map<string, Employee>();
  /**
   * Estado "en la base": `findById` entrega la misma instancia que se guardó, así que su estado ya
   * refleja cambios no guardados. Este mapa emula el `WHERE status = 'ACTIVE'` del adaptador Prisma.
   */
  private readonly persistedStatus = new Map<string, EmployeeStatus>();

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

  add(
    employee: Employee,
  ): Promise<Result<void, EmployeeAlreadyExistsError | EmployeeRfcAlreadyRegisteredError>> {
    const others = this.others(employee);
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
    this.store(employee, employee.snapshot.status);
    return Promise.resolve(ok(undefined));
  }

  saveRfc(
    employee: Employee,
  ): Promise<Result<void, EmployeeRfcAlreadyRegisteredError | EmployeeInactiveError>> {
    if (!this.isActive(employee)) {
      return Promise.resolve(err(new EmployeeInactiveError(employee.id)));
    }
    const { rfc } = employee.snapshot;
    if (rfc && this.others(employee).some((other) => other.snapshot.rfc?.equals(rfc) === true)) {
      return Promise.resolve(err(new EmployeeRfcAlreadyRegisteredError(rfc.value)));
    }
    this.store(employee, 'ACTIVE');
    return Promise.resolve(ok(undefined));
  }

  saveSite(employee: Employee): Promise<Result<void, EmployeeInactiveError>> {
    if (!this.isActive(employee)) {
      return Promise.resolve(err(new EmployeeInactiveError(employee.id)));
    }
    this.store(employee, 'ACTIVE');
    return Promise.resolve(ok(undefined));
  }

  saveTermination(employee: Employee): Promise<Result<void, EmployeeAlreadyTerminatedError>> {
    if (!this.isActive(employee)) {
      return Promise.resolve(err(new EmployeeAlreadyTerminatedError(employee.id)));
    }
    this.store(employee, employee.snapshot.status);
    return Promise.resolve(ok(undefined));
  }

  private others(employee: Employee): Employee[] {
    return [...this.employees.values()].filter((other) => other.id !== employee.id);
  }

  private isActive(employee: Employee): boolean {
    return this.persistedStatus.get(employee.id) === 'ACTIVE';
  }

  private store(employee: Employee, status: EmployeeStatus): void {
    this.employees.set(employee.id, employee);
    this.persistedStatus.set(employee.id, status);
  }
}
