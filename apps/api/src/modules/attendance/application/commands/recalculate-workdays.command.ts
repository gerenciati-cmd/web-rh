import type { WorkdayRecalculationDto } from '@rrhh/contracts';
import { err, InvalidValueError, MAX_WORKDAY_RANGE_DAYS, ok, type DomainError } from '@rrhh/domain';

import type { Clock, TransactionRunner } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import {
  EmployeeInactiveError,
  EmployeeNotFoundError,
  EmployeeWithoutRfcError,
  EmployeeWithoutSiteError,
  SiteNotFoundError,
} from '../../domain/errors';
import { addDays, daysBetween } from '../../domain/local-date';
import type { PunchRepository } from '../../domain/punch.repository';
import type { Shift, ShiftId } from '../../domain/shift';
import type { ShiftAssignment } from '../../domain/shift-assignment';
import type { ShiftAssignmentRepository } from '../../domain/shift-assignment.repository';
import type { ShiftRepository } from '../../domain/shift.repository';
import {
  calculateWorkdays,
  windowBoundaries,
  type PlannedDate,
} from '../../domain/workday-calculator';
import type { WorkdayRepository } from '../../domain/workday.repository';
import type { SiteDirectory } from '../ports/site-directory';
import type { WorkdayEmployeeDirectory } from '../ports/workday-employee-directory';

export interface RecalculateWorkdaysInput {
  companyId: string;
  employeeId: string;
  from: string;
  to: string;
}

interface Deps {
  workdayEmployeeDirectory: WorkdayEmployeeDirectory;
  deviceSiteDirectory: SiteDirectory;
  shiftAssignmentRepository: ShiftAssignmentRepository;
  shiftRepository: ShiftRepository;
  punchRepository: PunchRepository;
  workdayRepository: WorkdayRepository;
  transactionRunner: TransactionRunner;
  clock: Clock;
}

/** Asignación vigente en `date`: la más reciente con `effectiveFrom ≤ date` (historial ascendente). */
function assignmentOn(
  assignments: readonly ShiftAssignment[],
  date: string,
): ShiftAssignment | null {
  let current: ShiftAssignment | null = null;
  for (const assignment of assignments) {
    if (assignment.effectiveFrom > date) break;
    current = assignment;
  }
  return current;
}

/**
 * Recalcula y reemplaza las jornadas guardadas de un colaborador en las fechas cerradas de un
 * rango (README de attendance-asistencia-diaria, decisiones 10 y 19). Sirve también para un
 * colaborador desvinculado, acotado a su fecha de baja. Uno de otra empresa responde como
 * inexistente.
 */
export class RecalculateWorkdays implements Command<
  RecalculateWorkdaysInput,
  WorkdayRecalculationDto
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: RecalculateWorkdaysInput) {
    const employee = await this.deps.workdayEmployeeDirectory.find(input.employeeId);
    if (employee?.companyId !== input.companyId) {
      return err<DomainError>(new EmployeeNotFoundError(input.employeeId));
    }
    // Una baja guardada antes de que existiera la fecha no da dónde terminar las jornadas.
    if (!employee.active && employee.terminationDate === null) {
      return err<DomainError>(new EmployeeInactiveError(input.employeeId));
    }
    if (employee.rfc === null) return err<DomainError>(new EmployeeWithoutRfcError(employee.id));
    if (employee.siteId === null) {
      return err<DomainError>(new EmployeeWithoutSiteError(employee.id));
    }
    const site = await this.deps.deviceSiteDirectory.find(employee.siteId);
    if (!site) return err<DomainError>(new SiteNotFoundError(employee.siteId));
    const span = daysBetween(input.from, input.to);
    if (span < 0 || span + 1 > MAX_WORKDAY_RANGE_DAYS) {
      return err<DomainError>(
        new InvalidValueError(
          `El rango debe ir de la fecha inicial a la final y no pasar de ${MAX_WORKDAY_RANGE_DAYS} días`,
        ),
      );
    }

    const rfc = employee.rfc;
    const timeZone = site.timeZone;
    // Recálculos concurrentes del mismo colaborador (jobs automáticos y el endpoint manual)
    // chocaban en la llave primaria al borrar e insertar (revisión del plan 002, Low-2): el
    // candado por colaborador dentro de la transacción los pone en fila.
    return this.deps.transactionRunner.run(async () => {
      await this.deps.workdayRepository.lockEmployee(employee.id);
      const calendar = await this.buildCalendar(employee.id, input.from, span);
      const boundaries = windowBoundaries(calendar, timeZone);
      const first = boundaries[1];
      const last = boundaries.at(-1);
      if (!first || !last) throw new Error('Calendario de jornadas incompleto');
      const punches = await this.deps.punchRepository.listInstants(rfc, first, last);

      const { workdays, closedDates, pendingDates } = calculateWorkdays({
        employeeId: employee.id,
        companyId: employee.companyId,
        calendar,
        timeZone,
        punches,
        employedFrom: employee.hireDate,
        employedUntil: employee.terminationDate,
        now: this.deps.clock.now(),
      });
      await this.deps.workdayRepository.replaceDates(employee.id, closedDates, workdays);

      return ok({
        recalculatedDates: closedDates.length,
        storedWorkdays: workdays.length,
        pendingDates,
      });
    });
  }

  /** Fechas consecutivas de `from − 1` a `to + 1` con el turno vigente de cada una. */
  private async buildCalendar(
    employeeId: string,
    from: string,
    span: number,
  ): Promise<PlannedDate[]> {
    const assignments = await this.deps.shiftAssignmentRepository.listByEmployee(employeeId);
    const dates = Array.from({ length: span + 3 }, (_, index) => addDays(from, index - 1));
    const applied = dates.map((date) => ({ date, assignment: assignmentOn(assignments, date) }));

    const shifts = new Map<ShiftId, Shift>();
    for (const { assignment } of applied) {
      if (!assignment || shifts.has(assignment.shiftId)) continue;
      const shift = await this.deps.shiftRepository.findById(assignment.shiftId);
      // La asignación referencia el turno con FK: que falte es corrupción, no un caso de negocio.
      if (!shift) throw new Error(`El turno ${assignment.shiftId} asignado no existe`);
      shifts.set(assignment.shiftId, shift);
    }

    return applied.map(({ date, assignment }): PlannedDate => {
      const shift = assignment ? shifts.get(assignment.shiftId) : undefined;
      return {
        date,
        plan: shift
          ? { shiftId: shift.id, day: shift.dayOn(date), toleranceMinutes: shift.toleranceMinutes }
          : null,
      };
    });
  }
}
