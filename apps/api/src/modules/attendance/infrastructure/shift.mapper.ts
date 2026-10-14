import type { ShiftAssignmentDto, ShiftDto } from '@rrhh/contracts';

import type {
  AttendanceShift as ShiftRow,
  AttendanceShiftAssignment as ShiftAssignmentRow,
} from '@/infrastructure/database/generated/client';

import { Shift, type ShiftDay, type ShiftId } from '../domain/shift';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * La columna `days` solo la escribe esta app, así que cualquier otra forma es corrupción: se
 * falla fuerte en vez de entregar un ciclo inventado.
 */
function parseDays(value: unknown): ShiftDay[] {
  if (!Array.isArray(value)) throw new Error('Columna days de turno inválida: no es un arreglo');
  return value.map((item: unknown): ShiftDay => {
    if (isRecord(item) && item.type === 'REST') return { type: 'REST' };
    if (
      isRecord(item) &&
      item.type === 'WORK' &&
      typeof item.start === 'string' &&
      typeof item.end === 'string' &&
      typeof item.mealBreakMinutes === 'number'
    ) {
      return {
        type: 'WORK',
        start: item.start,
        end: item.end,
        mealBreakMinutes: item.mealBreakMinutes,
      };
    }
    throw new Error('Columna days de turno inválida: día desconocido');
  });
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Traductor entre filas Prisma y dominio/DTOs de turnos; ningún tipo de Prisma sale de aquí. */
export const ShiftMapper = {
  toDomain(row: ShiftRow): Shift {
    return Shift.restore(row.id as ShiftId, {
      companyId: row.companyId,
      name: row.name,
      nameKey: row.nameKey,
      cycleStartDate: toDateOnly(row.cycleStartDate),
      toleranceMinutes: row.toleranceMinutes,
      days: parseDays(row.days),
      active: row.active,
      createdAt: row.createdAt,
    });
  },

  toPersistence(shift: Shift) {
    return {
      id: shift.id,
      companyId: shift.companyId,
      name: shift.name,
      nameKey: shift.nameKey,
      cycleStartDate: new Date(`${shift.cycleStartDate}T00:00:00Z`),
      toleranceMinutes: shift.toleranceMinutes,
      days: shift.days.map((day) => ({ ...day })),
      active: shift.active,
      createdAt: shift.createdAt,
    };
  },

  toDto(row: ShiftRow): ShiftDto {
    return {
      id: row.id,
      name: row.name,
      cycleStartDate: toDateOnly(row.cycleStartDate),
      toleranceMinutes: row.toleranceMinutes,
      days: parseDays(row.days),
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    };
  },
};

export const ShiftAssignmentMapper = {
  toDto(row: ShiftAssignmentRow & { shift: { name: string } }): ShiftAssignmentDto {
    return {
      effectiveFrom: toDateOnly(row.effectiveFrom),
      shiftId: row.shiftId,
      shiftName: row.shift.name,
      assignedAt: row.assignedAt.toISOString(),
      assignedBy: row.assignedBy,
    };
  },
};
