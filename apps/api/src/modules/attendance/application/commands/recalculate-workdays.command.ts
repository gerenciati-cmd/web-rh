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
import { applyLatenessRule, latenessSegments } from '../../domain/lateness-rule';
import type { LatenessRuleRepository } from '../../domain/lateness-rule.repository';
import { daysBetween } from '../../domain/local-date';
import type { PunchRepository } from '../../domain/punch.repository';
import type { ShiftAssignmentRepository } from '../../domain/shift-assignment.repository';
import type { ShiftRepository } from '../../domain/shift.repository';
import { calculateWorkdays, windowBoundaries } from '../../domain/workday-calculator';
import type { WorkdayRepository } from '../../domain/workday.repository';
import { buildEmployeeCalendar } from '../employee-calendar';
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
  latenessRuleRepository: LatenessRuleRepository;
  workdayRepository: WorkdayRepository;
  transactionRunner: TransactionRunner;
  clock: Clock;
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
      const calendar = await buildEmployeeCalendar(this.deps, employee.id, input.from, span);
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

      // Se recuenta el tramo ENTERO de cada regla que toca el rango, no solo los días recalculados
      // (decisión 27): un retardo que desaparece debe deshacer la falta que había completado, y
      // los días que se cierran después completan bloques con los retardos ya guardados.
      const now = this.deps.clock.now();
      const rules = await this.deps.latenessRuleRepository.listByCompany(employee.companyId);
      const segments = latenessSegments(rules, input.from, input.to);
      const firstSegment = segments[0];
      const lastSegment = segments.at(-1);
      if (!firstSegment || !lastSegment) throw new Error('Tramos de retardos incompletos');
      const closed = new Set(closedDates);
      const stored = (
        await this.deps.workdayRepository.listBetween(
          employee.id,
          firstSegment.start,
          lastSegment.end,
        )
      ).filter((workday) => !closed.has(workday.date));
      const merged = [...stored, ...workdays];
      const adjusted = segments.flatMap((segment) =>
        applyLatenessRule(
          merged.filter((workday) => workday.date >= segment.start && workday.date <= segment.end),
          segment.threshold,
          now,
        ),
      );
      await this.deps.workdayRepository.replaceDates(
        employee.id,
        [...closedDates, ...stored.map((workday) => workday.date)],
        adjusted,
      );

      return ok({
        recalculatedDates: closedDates.length,
        storedWorkdays: workdays.length,
        pendingDates,
      });
    });
  }
}
