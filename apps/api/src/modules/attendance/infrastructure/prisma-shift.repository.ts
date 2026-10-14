import { err, ok, type Result } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';
import { isUniqueViolation } from '@/infrastructure/database/prisma-errors';

import { ShiftAlreadyExistsError } from '../domain/errors';
import type { Shift, ShiftId } from '../domain/shift';
import type { ShiftRepository } from '../domain/shift.repository';

import { ShiftMapper } from './shift.mapper';

export class PrismaShiftRepository implements ShiftRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findById(id: ShiftId): Promise<Shift | null> {
    const row = await this.deps.database.client.attendanceShift.findUnique({ where: { id } });
    return row ? ShiftMapper.toDomain(row) : null;
  }

  async add(shift: Shift): Promise<Result<void, ShiftAlreadyExistsError>> {
    try {
      await this.deps.database.client.attendanceShift.create({
        data: ShiftMapper.toPersistence(shift),
      });
      return ok(undefined);
    } catch (error) {
      // Carrera entre dos altas con el mismo nombre en la empresa: el índice único decide.
      if (isUniqueViolation(error)) return err(new ShiftAlreadyExistsError(shift.name));
      throw error;
    }
  }
}
