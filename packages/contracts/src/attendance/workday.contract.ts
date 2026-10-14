import { MAX_WORKDAY_RANGE_DAYS, WORKDAY_STATUSES } from '@rrhh/domain';
import { z } from 'zod';

import { defineRoute, requires } from '../http';

const MS_PER_DAY = 86_400_000;

function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

// ── Modelos ────────────────────────────────────────────────────────────────
const WorkdayRangeFields = z.object({
  from: z.iso.date().describe('Primera fecha del rango (YYYY-MM-DD)'),
  to: z.iso
    .date()
    .describe(`Última fecha del rango, inclusive (máximo ${MAX_WORKDAY_RANGE_DAYS} días)`),
});

/** Rango de fechas inclusivo; no puede invertirse ni pasar del máximo de días. */
export const WorkdayRangeSchema = WorkdayRangeFields.refine((range) => range.from <= range.to, {
  path: ['to'],
  message: 'La fecha final no puede ser anterior a la inicial',
}).refine(
  (range) => (utcDay(range.to) - utcDay(range.from)) / MS_PER_DAY + 1 <= MAX_WORKDAY_RANGE_DAYS,
  { path: ['to'], message: `El rango no puede pasar de ${MAX_WORKDAY_RANGE_DAYS} días` },
);
export type WorkdayRange = z.output<typeof WorkdayRangeSchema>;

export const RecalculateWorkdaysSchema = WorkdayRangeSchema.meta({
  id: 'RecalculateAttendanceWorkdaysInput',
});
export type RecalculateWorkdaysInput = z.input<typeof RecalculateWorkdaysSchema>;

export const WorkdaySchema = z
  .object({
    date: z.iso.date().describe('Fecha de la jornada (YYYY-MM-DD, día en que empieza el turno)'),
    shiftId: z.uuid().describe('Turno que aplicaba ese día'),
    shiftName: z.string(),
    status: z
      .enum(WORKDAY_STATUSES)
      .describe(
        [
          'Estado de la jornada:',
          '`ATTENDED` = día laborable con entrada y salida;',
          '`ABSENT_NO_PUNCHES` = falta, día laborable sin marcaciones;',
          '`ABSENT_SINGLE_PUNCH` = falta, día laborable con una sola marcación;',
          '`REST_WORKED` = descanso trabajado, marcaciones en un día de descanso.',
        ].join(' '),
      ),
    scheduledStartAt: z.iso
      .datetime()
      .nullable()
      .describe('Entrada programada (UTC); null en descanso trabajado'),
    scheduledEndAt: z.iso
      .datetime()
      .nullable()
      .describe('Salida programada (UTC); null en descanso trabajado'),
    scheduledMinutes: z
      .number()
      .int()
      .describe('Minutos de jornada programados, sin la comida (0 en descanso trabajado)'),
    firstPunchAt: z.iso
      .datetime()
      .nullable()
      .describe('Primera marcación del día (entrada); null sin marcaciones'),
    lastPunchAt: z.iso
      .datetime()
      .nullable()
      .describe('Última marcación del día (salida); null sin marcaciones'),
    punchCount: z.number().int().min(0).describe('Marcaciones atribuidas al día'),
    lateMinutes: z
      .number()
      .int()
      .min(0)
      .describe('Minutos de retardo desde la entrada programada; 0 dentro de la tolerancia'),
    workedMinutes: z
      .number()
      .int()
      .min(0)
      .describe('Minutos trabajados: salida − entrada, menos la comida en días laborables'),
    overtimeMinutes: z
      .number()
      .int()
      .min(0)
      .describe('Minutos trabajados por encima de la jornada (solo medidos, sin autorización)'),
    calculatedAt: z.iso.datetime().describe('Cuándo se calculó la jornada'),
  })
  .meta({ id: 'AttendanceWorkday' });
export type WorkdayDto = z.infer<typeof WorkdaySchema>;

export const WorkdayRecalculationSchema = z
  .object({
    recalculatedDates: z
      .number()
      .int()
      .min(0)
      .describe('Fechas cerradas que se recalcularon (con o sin jornada guardada)'),
    storedWorkdays: z.number().int().min(0).describe('Jornadas guardadas'),
    pendingDates: z
      .array(z.iso.date())
      .describe(
        'Fechas aún abiertas (su ventana de marcaciones no ha terminado): no se calcularon',
      ),
  })
  .meta({ id: 'AttendanceWorkdayRecalculation' });
export type WorkdayRecalculationDto = z.infer<typeof WorkdayRecalculationSchema>;

const EmployeeParams = z.object({
  companyId: z.uuid().describe('Id de la empresa del colaborador'),
  employeeId: z.uuid().describe('Id del colaborador'),
});

// ── Rutas ──────────────────────────────────────────────────────────────────
export const attendanceWorkdayRoutes = {
  recalculateEmployeeWorkdays: defineRoute({
    method: 'POST',
    path: '/companies/:companyId/attendance/employees/:employeeId/workdays/recalculation',
    summary: 'Recalcula las jornadas de un colaborador en un rango de fechas',
    description: [
      'Calcula las jornadas de un colaborador a partir de su turno y sus marcaciones, y reemplaza las guardadas en las fechas cerradas del rango. Las fechas aún abiertas se reportan como pendientes y no se calculan. Funciona también para colaboradores desvinculados (solo hasta su fecha de baja).',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      `**Necesita:** un rango \`from\`–\`to\` de hasta ${MAX_WORKDAY_RANGE_DAYS} días. El colaborador debe tener RFC (sus marcaciones se atribuyen por RFC) y sede asignada (da la zona horaria).`,
    ].join('\n'),
    errors: [
      'EMPLOYEE_NOT_FOUND',
      'SITE_NOT_FOUND',
      'EMPLOYEE_WITHOUT_RFC',
      'EMPLOYEE_WITHOUT_SITE',
      { code: 'EMPLOYEE_INACTIVE', variant: 'employees' },
    ],
    access: requires('attendance.workdays:recalculate', { companyParam: 'companyId' }),
    params: EmployeeParams,
    body: RecalculateWorkdaysSchema,
    response: WorkdayRecalculationSchema,
  }),
  listEmployeeWorkdays: defineRoute({
    method: 'GET',
    path: '/companies/:companyId/attendance/employees/:employeeId/workdays',
    summary: 'Jornadas guardadas de un colaborador',
    description: [
      'Devuelve las jornadas guardadas de un colaborador en un rango de fechas, en orden ascendente. Las fechas sin jornada (descanso sin marcaciones, sin turno, fuera de su contratación o aún sin calcular) no aparecen.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      `**Necesita:** un rango \`from\`–\`to\` de hasta ${MAX_WORKDAY_RANGE_DAYS} días. No modifica datos.`,
    ].join('\n'),
    errors: ['EMPLOYEE_NOT_FOUND'],
    access: requires('attendance.workdays:read', { companyParam: 'companyId' }),
    params: EmployeeParams,
    query: WorkdayRangeSchema,
    response: z.object({ items: z.array(WorkdaySchema) }),
  }),
};
