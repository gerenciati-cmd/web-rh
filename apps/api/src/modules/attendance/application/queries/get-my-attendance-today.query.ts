import type { MyTodayDto } from '@rrhh/contracts';
import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import {
  AccountNotLinkedError,
  EmployeeNotFoundError,
  EmployeeWithoutSiteError,
  SiteNotFoundError,
} from '../../domain/errors';
import { localDateOf } from '../../domain/local-date';
import type { PunchRepository } from '../../domain/punch.repository';
import { workMinutes } from '../../domain/shift';
import type { ShiftAssignmentRepository } from '../../domain/shift-assignment.repository';
import type { ShiftRepository } from '../../domain/shift.repository';
import {
  scheduledEnd,
  scheduledStart,
  windowBoundaries,
  type PlannedDate,
} from '../../domain/workday-calculator';
import { buildEmployeeCalendar } from '../employee-calendar';
import type { SiteDirectory } from '../ports/site-directory';
import type { WorkdayEmployeeDirectory } from '../ports/workday-employee-directory';

interface Input {
  employeeId: string | null;
}

/**
 * Turno y marcaciones de hoy del propio colaborador. Hoy no tiene jornada guardada (solo las
 * fechas cerradas la tienen): se muestra el plan y las marcaciones crudas, sin calcular retardo.
 */
export class GetMyAttendanceToday implements Command<Input, MyTodayDto> {
  constructor(
    private readonly deps: {
      workdayEmployeeDirectory: WorkdayEmployeeDirectory;
      deviceSiteDirectory: SiteDirectory;
      shiftAssignmentRepository: ShiftAssignmentRepository;
      shiftRepository: ShiftRepository;
      punchRepository: PunchRepository;
      clock: Clock;
    },
  ) {}

  async execute({ employeeId }: Input) {
    if (employeeId === null) return err<DomainError>(new AccountNotLinkedError());
    const employee = await this.deps.workdayEmployeeDirectory.find(employeeId);
    if (!employee) return err<DomainError>(new EmployeeNotFoundError(employeeId));
    if (employee.siteId === null) {
      return err<DomainError>(new EmployeeWithoutSiteError(employee.id));
    }
    const site = await this.deps.deviceSiteDirectory.find(employee.siteId);
    if (!site) return err<DomainError>(new SiteNotFoundError(employee.siteId));

    const timeZone = site.timeZone;
    const today = localDateOf(this.deps.clock.now(), timeZone);
    const empty = ok<MyTodayDto>({ date: today, timeZone, shift: null, punches: [] });
    if (
      today < employee.hireDate ||
      (employee.terminationDate !== null && today > employee.terminationDate)
    ) {
      return empty;
    }

    // [ayer, hoy, mañana]: la ventana de hoy depende de los turnos vecinos.
    const calendar = await buildEmployeeCalendar(this.deps, employee.id, today, 0);
    const plan = calendar[1]?.plan;
    if (!plan) return empty;
    const shift = await this.deps.shiftRepository.findById(plan.shiftId);
    // La asignación referencia el turno con FK: que falte es corrupción, no un caso de negocio.
    if (!shift) throw new Error(`El turno ${plan.shiftId} asignado no existe`);

    const day: NonNullable<MyTodayDto['shift']>['day'] =
      plan.day.type === 'REST'
        ? { type: 'REST' }
        : {
            type: 'WORK',
            scheduledStartAt: scheduledStart(today, plan.day, timeZone).toISOString(),
            scheduledEndAt: scheduledEnd(today, plan.day, timeZone).toISOString(),
            scheduledMinutes: workMinutes(plan.day),
            mealBreakMinutes: plan.day.mealBreakMinutes,
            toleranceMinutes: plan.toleranceMinutes,
          };

    const punches = await this.punchesInWindow(employee.rfc, calendar, timeZone);

    return ok<MyTodayDto>({
      date: today,
      timeZone,
      shift: { id: shift.id, name: shift.name, day },
      punches,
    });
  }

  /** Marcaciones de la ventana de hoy, `[b(1), b(2))` como en el recálculo; sin RFC no hay a quién atribuirlas. */
  private async punchesInWindow(
    rfc: string | null,
    calendar: readonly PlannedDate[],
    timeZone: string,
  ): Promise<string[]> {
    if (rfc === null) return [];
    const boundaries = windowBoundaries(calendar, timeZone);
    const start = boundaries[1];
    const end = boundaries[2];
    if (!start || !end) throw new Error('Calendario de jornadas incompleto');
    const instants = await this.deps.punchRepository.listInstants(rfc, start, end);
    return instants
      .map((instant) => instant.getTime())
      .sort((a, b) => a - b)
      .map((time) => new Date(time).toISOString());
  }
}
