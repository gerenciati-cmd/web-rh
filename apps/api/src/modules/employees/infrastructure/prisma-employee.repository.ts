import { err, ok, type NationalId, type PersonalRfc, type Result } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';
import { isUniqueViolation } from '@/infrastructure/database/prisma-errors';

import type { Employee, EmployeeId } from '../domain/employee';
import type { EmployeeRepository } from '../domain/employee.repository';
import {
  EmployeeAlreadyExistsError,
  EmployeeAlreadyTerminatedError,
  EmployeeInactiveError,
  EmployeeRfcAlreadyRegisteredError,
} from '../domain/errors';

import { EmployeeMapper } from './employee.mapper';

export class PrismaEmployeeRepository implements EmployeeRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findById(id: EmployeeId): Promise<Employee | null> {
    const row = await this.deps.database.client.employee.findUnique({ where: { id } });
    return row ? EmployeeMapper.toDomain(row) : null;
  }

  async existsInCompany(companyId: string, nationalId: NationalId): Promise<boolean> {
    const count = await this.deps.database.client.employee.count({
      where: {
        companyId,
        nationalIdCountry: nationalId.country,
        nationalIdNumber: nationalId.value,
      },
    });
    return count > 0;
  }

  async existsByRfc(rfc: PersonalRfc, exceptId?: EmployeeId): Promise<boolean> {
    const count = await this.deps.database.client.employee.count({
      where: { rfc: rfc.value, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    return count > 0;
  }

  async add(
    employee: Employee,
  ): Promise<Result<void, EmployeeAlreadyExistsError | EmployeeRfcAlreadyRegisteredError>> {
    try {
      await this.deps.database.client.employee.create({
        data: EmployeeMapper.toPersistence(employee),
      });
      return ok(undefined);
    } catch (error) {
      if (isUniqueViolation(error)) {
        // El error de Prisma no dice qué índice falló. Mismo orden que el comando: si el CURP ya
        // está en la empresa fue ese; si no, y el RFC es de otro, fue el RFC.
        const { rfc, nationalId, companyId } = employee.snapshot;
        const curpTaken = await this.deps.database.client.employee.count({
          where: {
            companyId,
            nationalIdCountry: nationalId.country,
            nationalIdNumber: nationalId.value,
            id: { not: employee.id },
          },
        });
        if (curpTaken === 0 && rfc && (await this.existsByRfc(rfc, employee.id))) {
          return err(new EmployeeRfcAlreadyRegisteredError(rfc.value));
        }
        return err(new EmployeeAlreadyExistsError(nationalId.format()));
      }
      throw error;
    }
  }

  // Las tres actualizaciones exigen que la fila siga ACTIVE. El colaborador se acaba de leer, así
  // que 0 filas significa que otra petición lo dio de baja entretanto.

  async saveRfc(
    employee: Employee,
  ): Promise<Result<void, EmployeeRfcAlreadyRegisteredError | EmployeeInactiveError>> {
    try {
      const { count } = await this.deps.database.client.employee.updateMany({
        where: { id: employee.id, status: 'ACTIVE' },
        data: EmployeeMapper.toRfc(employee),
      });
      return count === 0 ? err(new EmployeeInactiveError(employee.id)) : ok(undefined);
    } catch (error) {
      // El RFC es la única columna única que se escribe aquí.
      const { rfc } = employee.snapshot;
      if (isUniqueViolation(error) && rfc) {
        return err(new EmployeeRfcAlreadyRegisteredError(rfc.value));
      }
      throw error;
    }
  }

  async saveSite(employee: Employee): Promise<Result<void, EmployeeInactiveError>> {
    const { count } = await this.deps.database.client.employee.updateMany({
      where: { id: employee.id, status: 'ACTIVE' },
      data: EmployeeMapper.toSite(employee),
    });
    return count === 0 ? err(new EmployeeInactiveError(employee.id)) : ok(undefined);
  }

  async saveTermination(employee: Employee): Promise<Result<void, EmployeeAlreadyTerminatedError>> {
    const { count } = await this.deps.database.client.employee.updateMany({
      where: { id: employee.id, status: 'ACTIVE' },
      data: EmployeeMapper.toTermination(employee),
    });
    return count === 0 ? err(new EmployeeAlreadyTerminatedError(employee.id)) : ok(undefined);
  }
}
