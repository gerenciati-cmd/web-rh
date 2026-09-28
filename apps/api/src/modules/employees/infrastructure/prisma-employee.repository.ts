import { err, ok, type NationalId, type Result } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';
import { isUniqueViolation } from '@/infrastructure/database/prisma-errors';

import type { Employee, EmployeeId } from '../domain/employee';
import type { EmployeeRepository } from '../domain/employee.repository';
import { EmployeeAlreadyExistsError } from '../domain/errors';

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

  async save(employee: Employee): Promise<Result<void, EmployeeAlreadyExistsError>> {
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
        return err(new EmployeeAlreadyExistsError(employee.snapshot.nationalId.format()));
      }
      throw error;
    }
  }
}
