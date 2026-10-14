import type { WorkdayDto } from '@rrhh/contracts';
import { WORKDAY_STATUSES, type WorkdayStatus } from '@rrhh/domain';

import type { AttendanceWorkday as WorkdayRow } from '@/infrastructure/database/generated/client';

import type { Workday } from '../domain/workday';

function isWorkdayStatus(value: string): value is WorkdayStatus {
  return (WORKDAY_STATUSES as readonly string[]).includes(value);
}

/** La columna `status` solo la escribe esta app: otro valor es corrupción y se falla fuerte. */
function parseStatus(value: string): WorkdayStatus {
  if (!isWorkdayStatus(value)) throw new Error(`Estado de jornada desconocido: ${value}`);
  return value;
}

/** Traductor entre filas Prisma y dominio/DTOs de jornadas; ningún tipo de Prisma sale de aquí. */
export const WorkdayMapper = {
  toPersistence(workday: Workday) {
    return {
      employeeId: workday.employeeId,
      companyId: workday.companyId,
      date: new Date(`${workday.date}T00:00:00Z`),
      shiftId: workday.shiftId,
      status: workday.status,
      scheduledStartAt: workday.scheduledStartAt,
      scheduledEndAt: workday.scheduledEndAt,
      scheduledMinutes: workday.scheduledMinutes,
      firstPunchAt: workday.firstPunchAt,
      lastPunchAt: workday.lastPunchAt,
      punchCount: workday.punchCount,
      lateMinutes: workday.lateMinutes,
      workedMinutes: workday.workedMinutes,
      overtimeMinutes: workday.overtimeMinutes,
      calculatedAt: workday.calculatedAt,
    };
  },

  toDto(row: WorkdayRow & { shift: { name: string } }): WorkdayDto {
    return {
      date: row.date.toISOString().slice(0, 10),
      shiftId: row.shiftId,
      shiftName: row.shift.name,
      status: parseStatus(row.status),
      scheduledStartAt: row.scheduledStartAt?.toISOString() ?? null,
      scheduledEndAt: row.scheduledEndAt?.toISOString() ?? null,
      scheduledMinutes: row.scheduledMinutes,
      firstPunchAt: row.firstPunchAt?.toISOString() ?? null,
      lastPunchAt: row.lastPunchAt?.toISOString() ?? null,
      punchCount: row.punchCount,
      lateMinutes: row.lateMinutes,
      workedMinutes: row.workedMinutes,
      overtimeMinutes: row.overtimeMinutes,
      calculatedAt: row.calculatedAt.toISOString(),
    };
  },
};
