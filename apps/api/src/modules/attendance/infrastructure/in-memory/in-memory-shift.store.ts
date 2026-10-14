import type { Page, PageQuery, ShiftAssignmentDto, ShiftDto } from '@rrhh/contracts';
import { err, ok, type Result } from '@rrhh/domain';

import type { ShiftQueries } from '../../application/queries/shift.queries';
import { ShiftAlreadyExistsError } from '../../domain/errors';
import { Shift, type ShiftId } from '../../domain/shift';
import type { ShiftAssignment } from '../../domain/shift-assignment';
import type { ShiftAssignmentRepository } from '../../domain/shift-assignment.repository';
import type { ShiftRepository } from '../../domain/shift.repository';

/**
 * Adaptadores en memoria de turnos para tests. Cumplen los MISMOS contratos que la versión
 * Prisma; repositorios y queries comparten el almacén para que lo escrito sea visible al leer.
 */
export class InMemoryShiftStore {
  readonly shifts = new Map<string, Shift>();
  /** Clave `employeeId|effectiveFrom`. */
  readonly assignments = new Map<string, ShiftAssignment>();
}

function copyShift(shift: Shift): Shift {
  return Shift.restore(shift.id, {
    companyId: shift.companyId,
    name: shift.name,
    nameKey: shift.nameKey,
    cycleStartDate: shift.cycleStartDate,
    toleranceMinutes: shift.toleranceMinutes,
    days: shift.days.map((day) => ({ ...day })),
    active: shift.active,
    createdAt: shift.createdAt,
  });
}

function pageOf<T>(items: T[], { page, pageSize }: PageQuery): Page<T> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class InMemoryShiftRepository implements ShiftRepository {
  constructor(private readonly store: InMemoryShiftStore) {}

  findById(id: ShiftId): Promise<Shift | null> {
    const shift = this.store.shifts.get(id);
    return Promise.resolve(shift ? copyShift(shift) : null);
  }

  add(shift: Shift): Promise<Result<void, ShiftAlreadyExistsError>> {
    const duplicate = [...this.store.shifts.values()].some(
      (other) =>
        other.id === shift.id ||
        (other.companyId === shift.companyId && other.nameKey === shift.nameKey),
    );
    if (duplicate) return Promise.resolve(err(new ShiftAlreadyExistsError(shift.name)));
    this.store.shifts.set(shift.id, copyShift(shift));
    return Promise.resolve(ok(undefined));
  }
}

export class InMemoryShiftAssignmentRepository implements ShiftAssignmentRepository {
  constructor(private readonly store: InMemoryShiftStore) {}

  put(assignment: ShiftAssignment): Promise<void> {
    const key = `${assignment.employeeId}|${assignment.effectiveFrom}`;
    this.store.assignments.set(key, { ...assignment });
    return Promise.resolve();
  }

  listByEmployee(employeeId: string): Promise<ShiftAssignment[]> {
    const assignments = [...this.store.assignments.values()]
      .filter((assignment) => assignment.employeeId === employeeId)
      .sort((a, b) => compare(a.effectiveFrom, b.effectiveFrom))
      .map((assignment) => ({ ...assignment }));
    return Promise.resolve(assignments);
  }
}

export class InMemoryShiftQueries implements ShiftQueries {
  constructor(private readonly store: InMemoryShiftStore) {}

  listShifts(companyId: string, page: PageQuery): Promise<Page<ShiftDto>> {
    const shifts = [...this.store.shifts.values()]
      .filter((shift) => shift.companyId === companyId)
      // `localeCompare` como `in-memory-site.store.ts`: Postgres ordena por collation, no por código.
      .sort((a, b) => a.name.localeCompare(b.name) || compare(a.id, b.id));
    return Promise.resolve(
      pageOf(
        shifts.map((shift): ShiftDto => ({
          id: shift.id,
          name: shift.name,
          cycleStartDate: shift.cycleStartDate,
          toleranceMinutes: shift.toleranceMinutes,
          days: shift.days.map((day) => ({ ...day })),
          active: shift.active,
          createdAt: shift.createdAt.toISOString(),
        })),
        page,
      ),
    );
  }

  listAssignments(employeeId: string, page: PageQuery): Promise<Page<ShiftAssignmentDto>> {
    const assignments = [...this.store.assignments.values()]
      .filter((assignment) => assignment.employeeId === employeeId)
      .sort((a, b) => compare(b.effectiveFrom, a.effectiveFrom));
    return Promise.resolve(
      pageOf(
        assignments.map((assignment): ShiftAssignmentDto => ({
          effectiveFrom: assignment.effectiveFrom,
          shiftId: assignment.shiftId,
          shiftName: this.store.shifts.get(assignment.shiftId)?.name ?? '',
          assignedAt: assignment.assignedAt.toISOString(),
          assignedBy: assignment.assignedBy,
        })),
        page,
      ),
    );
  }
}
