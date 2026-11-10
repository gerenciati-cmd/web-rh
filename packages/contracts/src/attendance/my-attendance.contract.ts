import { z } from 'zod';

import { defineRoute, requires } from '../http';

import { WorkdaySchema } from './workday.contract';

// ── Modelos ────────────────────────────────────────────────────────────────
export const MyWorkdaysQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .describe('Mes YYYY-MM: el actual o el anterior, en la zona de la sede'),
});
export type MyWorkdaysQuery = z.input<typeof MyWorkdaysQuerySchema>;

const MyTodayDaySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('REST') }).describe('Día de descanso'),
  z
    .object({
      type: z.literal('WORK'),
      scheduledStartAt: z.iso.datetime().describe('Entrada programada (UTC)'),
      scheduledEndAt: z.iso.datetime().describe('Salida programada (UTC)'),
      scheduledMinutes: z.number().int().describe('Minutos de jornada programados, sin la comida'),
      mealBreakMinutes: z.number().int().describe('Minutos de comida'),
      toleranceMinutes: z.number().int().describe('Minutos de tolerancia de entrada'),
    })
    .describe('Día laborable'),
]);

export const MyTodaySchema = z
  .object({
    date: z.iso.date().describe('Fecha de hoy en la zona de la sede (YYYY-MM-DD)'),
    timeZone: z.string().describe('Zona horaria de la sede (IANA)'),
    shift: z
      .object({
        id: z.uuid().describe('Id del turno'),
        name: z.string().describe('Nombre del turno'),
        day: MyTodayDaySchema.describe('Lo que el turno marca para hoy'),
      })
      .nullable()
      .describe('Turno que aplica hoy; null sin turno asignado o fuera de la contratación'),
    punches: z
      .array(z.iso.datetime())
      .describe('Marcaciones dentro de la ventana de hoy (UTC), en orden ascendente'),
  })
  .meta({ id: 'AttendanceMyToday' });
export type MyTodayDto = z.infer<typeof MyTodaySchema>;

const MyWorkdaysResponseSchema = z.object({
  month: z.string().describe('Mes consultado (YYYY-MM)'),
  items: z.array(WorkdaySchema).describe('Jornadas guardadas del mes, en orden ascendente'),
});
export type MyWorkdaysDto = z.infer<typeof MyWorkdaysResponseSchema>;

// ── Rutas ──────────────────────────────────────────────────────────────────
export const myAttendanceRoutes = {
  listMyWorkdays: defineRoute({
    method: 'GET',
    path: '/me/attendance/workdays',
    summary: 'Mis jornadas guardadas de un mes',
    description: [
      'Devuelve las jornadas guardadas del colaborador autenticado en el mes actual o el anterior (según la zona de su sede), en orden ascendente. Las fechas sin jornada (descanso sin marcaciones, sin turno, aún sin calcular) no aparecen.',
      '',
      '**Quién puede:** el colaborador, solo sobre sí mismo.',
      '',
      '**Necesita:** `month` (YYYY-MM). La cuenta debe estar vinculada a un colaborador con sede. No modifica datos.',
    ].join('\n'),
    errors: [
      'ACCOUNT_NOT_LINKED',
      'EMPLOYEE_NOT_FOUND',
      'EMPLOYEE_WITHOUT_SITE',
      'SITE_NOT_FOUND',
      'MONTH_NOT_AVAILABLE',
    ],
    access: requires('attendance.workdays:read-own'),
    query: MyWorkdaysQuerySchema,
    response: MyWorkdaysResponseSchema,
  }),
  getMyAttendanceToday: defineRoute({
    method: 'GET',
    path: '/me/attendance/today',
    summary: 'Mi turno y marcaciones de hoy',
    description: [
      'Devuelve la fecha de hoy en la zona de la sede del colaborador autenticado, el turno que aplica y las marcaciones dentro de la ventana de hoy. No calcula la jornada de hoy: esa se guarda al cerrar la fecha.',
      '',
      '**Quién puede:** el colaborador, solo sobre sí mismo.',
      '',
      '**Necesita:** una cuenta vinculada a un colaborador con sede. No modifica datos.',
    ].join('\n'),
    errors: ['ACCOUNT_NOT_LINKED', 'EMPLOYEE_NOT_FOUND', 'EMPLOYEE_WITHOUT_SITE', 'SITE_NOT_FOUND'],
    access: requires('attendance.workdays:read-own'),
    response: MyTodaySchema,
  }),
};
