import { LATENESS_PERIODS, MAX_LATENESS_THRESHOLD } from '@rrhh/domain';
import { z } from 'zod';

import { defineRoute, requires } from '../http';

const PeriodSchema = z
  .enum(LATENESS_PERIODS)
  .describe(
    'Periodo de conteo: `WEEK` = semana lunes a domingo, `FORTNIGHT` = quincena (1–15 y 16–fin de mes), `MONTH` = mes calendario',
  );
const ThresholdSchema = z
  .int()
  .min(1)
  .max(MAX_LATENESS_THRESHOLD)
  .describe('N: cada N retardos del periodo, el que completa el bloque se vuelve falta');

export const SetLatenessRuleSchema = z
  .object({ threshold: ThresholdSchema, period: PeriodSchema })
  .meta({ id: 'SetAttendanceLatenessRuleInput' });
export type SetLatenessRuleInput = z.input<typeof SetLatenessRuleSchema>;

export const LatenessRuleSchema = z
  .object({
    effectiveFrom: z.iso.date().describe('Fecha desde la que rige la regla (YYYY-MM-DD)'),
    threshold: ThresholdSchema,
    period: PeriodSchema,
    setAt: z.iso.datetime(),
  })
  .meta({ id: 'AttendanceLatenessRule' });
export type LatenessRuleDto = z.infer<typeof LatenessRuleSchema>;

export const LatenessRulesSchema = z
  .object({
    items: z
      .array(LatenessRuleSchema)
      .describe('Historial, de la fecha más reciente a la más antigua'),
    default: z
      .object({ threshold: ThresholdSchema, period: PeriodSchema })
      .describe('Regla que aplica mientras la empresa no tenga una configurada'),
  })
  .meta({ id: 'AttendanceLatenessRules' });
export type LatenessRulesDto = z.infer<typeof LatenessRulesSchema>;

const CompanyParams = z.object({ companyId: z.uuid().describe('Id de la empresa') });
const RuleParams = CompanyParams.extend({
  effectiveFrom: z.iso.date().describe('Fecha desde la que rige la regla (YYYY-MM-DD)'),
});

export const attendanceLatenessRuleRoutes = {
  setLatenessRule: defineRoute({
    method: 'PUT',
    path: '/companies/:companyId/attendance/lateness-rules/:effectiveFrom',
    summary: 'Define la regla de N retardos = 1 falta desde una fecha',
    description: [
      'Define cuántos retardos de un periodo hacen una falta y cuál es el periodo (semana, quincena o mes). Si ya había una regla en esa misma fecha, la reemplaza. Una empresa sin regla usa 3 retardos por quincena.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** `threshold` y `period`. La fecha no puede ser anterior a hoy (UTC): no se recalculan jornadas guardadas. Un periodo se corta en el cambio de regla: los retardos de antes y de después no se suman.',
    ].join('\n'),
    errors: ['COMPANY_NOT_FOUND', 'LATENESS_RULE_IN_PAST'],
    access: requires('attendance.shifts:manage', { companyParam: 'companyId' }),
    params: RuleParams,
    body: SetLatenessRuleSchema,
    response: z.undefined(),
    successStatus: 204,
  }),
  listLatenessRules: defineRoute({
    method: 'GET',
    path: '/companies/:companyId/attendance/lateness-rules',
    summary: 'Historial de reglas de retardos de una empresa',
    description: [
      'Devuelve las reglas de N retardos = 1 falta de la empresa, de la más reciente a la más antigua, y la regla por defecto (3 por quincena) que aplica antes de la primera.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** el `companyId` en la ruta. No modifica datos.',
    ].join('\n'),
    errors: ['COMPANY_NOT_FOUND'],
    access: requires('attendance.shifts:read', { companyParam: 'companyId' }),
    params: CompanyParams,
    response: LatenessRulesSchema,
  }),
};
