import { err, ok, type NationalId, type PersonalRfc, type Result } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';
import { isUniqueViolation } from '@/infrastructure/database/prisma-errors';

import type { Employee, EmployeeId } from '../domain/employee';
import type { EmployeeRepository } from '../domain/employee.repository';
import { EmployeeAlreadyExistsError, EmployeeRfcAlreadyRegisteredError } from '../domain/errors';

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

  async save(
    employee: Employee,
  ): Promise<Result<void, EmployeeAlreadyExistsError | EmployeeRfcAlreadyRegisteredError>> {
    const data = EmployeeMapper.toPersistence(employee);
    try {
      await this.deps.database.client.employee.upsert({
        where: { id: data.id },
        create: data,
        update: data,
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
}
