import {
  MAX_MEAL_BREAK_MINUTES,
  MAX_SHIFT_CYCLE_DAYS,
  MAX_SHIFT_TOLERANCE_MINUTES,
  SHIFT_NAME_MAX_LENGTH,
  SHIFT_TIME_PATTERN,
} from '@rrhh/domain';
import { z } from 'zod';

import { CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

const MINUTES_PER_DAY = 1440;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Duración de una jornada: si la salida es menor o igual a la entrada, termina al día siguiente. */
function durationMinutes(start: string, end: string): number {
  const diff = toMinutes(end) - toMinutes(start);
  return diff <= 0 ? diff + MINUTES_PER_DAY : diff;
}

// ── Modelos ────────────────────────────────────────────────────────────────
const WorkDayFields = {
  type: z.literal('WORK'),
  start: z.string().regex(SHIFT_TIME_PATTERN).describe('Hora de entrada (HH:mm, 24 horas)'),
  end: z
    .string()
    .regex(SHIFT_TIME_PATTERN)
    .describe(
      'Hora de salida; si es menor o igual a la entrada, la jornada termina al día siguiente (igual = 24 horas)',
    ),
};
const MealBreakMinutes = z.number().int().min(0).max(MAX_MEAL_BREAK_MINUTES);
const MEAL_BREAK_DESCRIPTION = 'Minutos de comida que se descuentan de la jornada (0 = sin comida)';

/**
 * Día de entrada: la comida es opcional (0 por omisión). Va aparte del de lectura porque OpenAPI
 * distingue la forma de entrada de la de salida y un mismo modelo nombrado no puede tener dos.
 */
export const ShiftDayInputSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('REST') }),
    z.object({
      ...WorkDayFields,
      mealBreakMinutes: MealBreakMinutes.default(0).describe(MEAL_BREAK_DESCRIPTION),
    }),
  ])
  .meta({ id: 'CreateAttendanceShiftDayInput' });

export const ShiftDaySchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('REST') }),
    z.object({
      ...WorkDayFields,
      mealBreakMinutes: MealBreakMinutes.describe(MEAL_BREAK_DESCRIPTION),
    }),
  ])
  .meta({ id: 'AttendanceShiftDay' });

export const CreateShiftSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(SHIFT_NAME_MAX_LENGTH)
      .describe('Nombre del turno; único en la empresa sin distinguir mayúsculas'),
    cycleStartDate: z.iso.date().describe('Fecha en la que cae el día 1 del ciclo'),
    toleranceMinutes: z
      .number()
      .int()
      .min(0)
      .max(MAX_SHIFT_TOLERANCE_MINUTES)
      .describe('Minutos de tolerancia antes de contar un retardo'),
    days: z
      .array(ShiftDayInputSchema)
      .min(1)
      .max(MAX_SHIFT_CYCLE_DAYS)
      .describe('Días del ciclo, en orden; el ciclo se repite'),
  })
  .refine((input) => input.days.some((day) => day.type === 'WORK'), {
    path: ['days'],
    message: 'El turno necesita al menos un día laborable',
  })
  .superRefine((input, ctx) => {
    input.days.forEach((day, index) => {
      if (day.type === 'WORK' && day.mealBreakMinutes >= durationMinutes(day.start, day.end)) {
        ctx.addIssue({
          code: 'custom',
          path: ['days', index, 'mealBreakMinutes'],
          message: 'La comida debe ser menor que la jornada',
        });
      }
    });
  })
  .meta({ id: 'CreateAttendanceShiftInput' });
export type CreateShiftInput = z.input<typeof CreateShiftSchema>;

export const ShiftSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    cycleStartDate: z.iso.date(),
    toleranceMinutes: z.number().int(),
    days: z.array(ShiftDaySchema),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'AttendanceShift' });
export type ShiftDto = z.infer<typeof ShiftSchema>;

export const AssignShiftSchema = z
  .object({ shiftId: z.uuid().describe('Turno de la misma empresa que se asigna') })
  .meta({ id: 'AssignAttendanceShiftInput' });
export type AssignShiftInput = z.input<typeof AssignShiftSchema>;

export const ShiftAssignmentSchema = z
  .object({
    effectiveFrom: z.iso.date().describe('Fecha desde la que aplica el turno (YYYY-MM-DD)'),
    shiftId: z.uuid(),
    shiftName: z.string(),
    assignedAt: z.iso.datetime(),
    assignedBy: z.uuid().describe('Usuario que hizo la asignación'),
  })
  .meta({ id: 'AttendanceShiftAssignment' });
export type ShiftAssignmentDto = z.infer<typeof ShiftAssignmentSchema>;

const CompanyScopedParams = z.object({ companyId: z.uuid().describe('Id de la empresa') });
const EmployeeParams = z.object({
  companyId: z.uuid().describe('Id de la empresa del colaborador'),
  employeeId: z.uuid().describe('Id del colaborador'),
});
const AssignmentParams = EmployeeParams.extend({
  effectiveFrom: z.iso.date().describe('Fecha desde la que aplica el turno (YYYY-MM-DD)'),
});

// ── Rutas ──────────────────────────────────────────────────────────────────
export const attendanceShiftRoutes = {
  listShifts: defineRoute({
    method: 'GET',
    path: '/companies/:companyId/attendance/shifts',
    summary: 'Turnos de una empresa',
    description: [
      'Devuelve los turnos de una empresa, paginados y ordenados por nombre.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** el `companyId` en la ruta. No modifica datos.',
    ].join('\n'),
    access: requires('attendance.shifts:read', { companyParam: 'companyId' }),
    params: CompanyScopedParams,
    query: PageQuerySchema,
    response: pageOf(ShiftSchema),
  }),
  createShift: defineRoute({
    method: 'POST',
    path: '/companies/:companyId/attendance/shifts',
    summary: 'Crea un turno',
    description: [
      'Crea un turno de la empresa como un ciclo de días laborables y de descanso. Responde con el `id` del turno.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** nombre único en la empresa, fecha en la que cae el día 1 del ciclo, tolerancia de retardo y de 1 a 28 días con al menos un día laborable. Una salida menor o igual a la entrada cruza la medianoche.',
    ].join('\n'),
    errors: ['COMPANY_NOT_FOUND', 'SHIFT_ALREADY_EXISTS'],
    access: requires('attendance.shifts:manage', { companyParam: 'companyId' }),
    params: CompanyScopedParams,
    body: CreateShiftSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
  assignEmployeeShift: defineRoute({
    method: 'PUT',
    path: '/companies/:companyId/attendance/employees/:employeeId/shift-assignments/:effectiveFrom',
    summary: 'Asigna un turno a un colaborador desde una fecha',
    description: [
      'Asigna un turno a un colaborador a partir de una fecha. Si ya había una asignación en esa misma fecha, la reemplaza.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** el `shiftId` de un turno de la misma empresa. El colaborador debe estar activo. Acepta fechas pasadas y futuras.',
    ].join('\n'),
    errors: [
      'EMPLOYEE_NOT_FOUND',
      'SHIFT_NOT_FOUND',
      { code: 'EMPLOYEE_INACTIVE', variant: 'employees' },
    ],
    access: requires('attendance.shifts:manage', { companyParam: 'companyId' }),
    params: AssignmentParams,
    body: AssignShiftSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
  listEmployeeShiftAssignments: defineRoute({
    method: 'GET',
    path: '/companies/:companyId/attendance/employees/:employeeId/shift-assignments',
    summary: 'Historial de turnos de un colaborador',
    description: [
      'Devuelve las asignaciones de turno de un colaborador, paginadas, de la fecha más reciente a la más antigua.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** el `companyId` y el `employeeId` en la ruta. No modifica datos.',
    ].join('\n'),
    errors: ['EMPLOYEE_NOT_FOUND'],
    access: requires('attendance.shifts:read', { companyParam: 'companyId' }),
    params: EmployeeParams,
    query: PageQuerySchema,
    response: pageOf(ShiftAssignmentSchema),
  }),
};
