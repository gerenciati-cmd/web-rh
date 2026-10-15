import type { WorkdayDto } from '@rrhh/contracts';

import type { WorkdayQueries } from '../../application/queries/workday.queries';
import type { Workday } from '../../domain/workday';
import type { WorkdayRepository } from '../../domain/workday.repository';

/**
 * Lo que las queries leen del `InMemoryShiftStore` (el nombre del turno). Se declara por forma y
 * no se importa: arch:check prohíbe importar un doble `in-memory/` desde otro archivo que no sea test.
 */
interface ShiftNames {
  readonly shifts: ReadonlyMap<string, { readonly name: string }>;
}

/**
 * Adaptadores en memoria de jornadas para tests. Cumplen los MISMOS contratos que la versión
 * Prisma; repositorio y queries comparten el almacén para que lo escrito sea visible al leer.
 */
export class InMemoryWorkdayStore {
  /** Clave `employeeId|date`. */
  readonly workdays = new Map<string, Workday>();
}

function keyOf(employeeId: string, date: string): string {
  return `${employeeId}|${date}`;
}

export class InMemoryWorkdayRepository implements WorkdayRepository {
  constructor(private readonly store: InMemoryWorkdayStore) {}

  replaceDates(
    employeeId: string,
    dates: readonly string[],
    workdays: readonly Workday[],
  ): Promise<void> {
    for (const date of dates) this.store.workdays.delete(keyOf(employeeId, date));
    for (const workday of workdays) {
      this.store.workdays.set(keyOf(workday.employeeId, workday.date), { ...workday });
    }
    return Promise.resolve();
  }

  /** Los tests corren en un solo hilo y `replaceDates` es síncrono: no hay nada que serializar. */
  lockEmployee(_employeeId: string): Promise<void> {
    return Promise.resolve();
  }
}

export class InMemoryWorkdayQueries implements WorkdayQueries {
  constructor(
    private readonly store: InMemoryWorkdayStore,
    private readonly shifts: ShiftNames,
  ) {}

  listByEmployee(employeeId: string, from: string, to: string): Promise<WorkdayDto[]> {
    const workdays = [...this.store.workdays.values()]
      .filter(
        (workday) =>
          workday.employeeId === employeeId && workday.date >= from && workday.date <= to,
      )
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return Promise.resolve(
      workdays.map((workday): WorkdayDto => ({
        date: workday.date,
        shiftId: workday.shiftId,
        shiftName: this.shifts.shifts.get(workday.shiftId)?.name ?? '',
        status: workday.status,
        scheduledStartAt: workday.scheduledStartAt?.toISOString() ?? null,
        scheduledEndAt: workday.scheduledEndAt?.toISOString() ?? null,
        scheduledMinutes: workday.scheduledMinutes,
        firstPunchAt: workday.firstPunchAt?.toISOString() ?? null,
        lastPunchAt: workday.lastPunchAt?.toISOString() ?? null,
        punchCount: workday.punchCount,
        lateMinutes: workday.lateMinutes,
        workedMinutes: workday.workedMinutes,
        overtimeMinutes: workday.overtimeMinutes,
        calculatedAt: workday.calculatedAt.toISOString(),
      })),
    );
  }
}
