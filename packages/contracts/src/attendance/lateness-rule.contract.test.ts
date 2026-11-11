import { LATENESS_PERIODS, MAX_LATENESS_THRESHOLD } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { API_ERRORS } from '../errors';

import {
  LatenessRuleSchema,
  LatenessRulesSchema,
  SetLatenessRuleSchema,
  attendanceLatenessRuleRoutes,
} from './lateness-rule.contract';
import { WorkdaySchema } from './workday.contract';

describe('SetLatenessRuleSchema', () => {
  it('acepta N de 1 al máximo y cada periodo', () => {
    for (const period of LATENESS_PERIODS) {
      expect(SetLatenessRuleSchema.safeParse({ threshold: 1, period }).success).toBe(true);
    }
    expect(
      SetLatenessRuleSchema.safeParse({ threshold: MAX_LATENESS_THRESHOLD, period: 'MONTH' })
        .success,
    ).toBe(true);
  });

  it('el máximo de N es 31', () => {
    expect(MAX_LATENESS_THRESHOLD).toBe(31);
  });

  it.each([
    ['0', 0],
    ['32', 32],
    ['negativo', -1],
    ['decimal', 2.5],
    ['texto', '3'],
  ])('rechaza threshold %s, con el error en threshold', (_name, threshold) => {
    const result = SetLatenessRuleSchema.safeParse({ threshold, period: 'WEEK' });

    expect(!result.success && result.error.issues[0]?.path).toEqual(['threshold']);
  });

  it('rechaza un periodo desconocido, con el error en period', () => {
    const result = SetLatenessRuleSchema.safeParse({ threshold: 3, period: 'YEAR' });

    expect(!result.success && result.error.issues[0]?.path).toEqual(['period']);
  });

  it('exige ambos campos', () => {
    expect(SetLatenessRuleSchema.safeParse({ threshold: 3 }).success).toBe(false);
    expect(SetLatenessRuleSchema.safeParse({ period: 'WEEK' }).success).toBe(false);
  });
});

describe('LatenessRuleSchema y LatenessRulesSchema', () => {
  const rule = {
    effectiveFrom: '2026-11-16',
    threshold: 3,
    period: 'FORTNIGHT',
    setAt: '2026-11-11T12:00:00.000Z',
  };

  it('acepta una regla con fecha y fecha-hora ISO', () => {
    expect(LatenessRuleSchema.parse(rule)).toEqual(rule);
    expect(LatenessRuleSchema.safeParse({ ...rule, effectiveFrom: 'ayer' }).success).toBe(false);
    expect(LatenessRuleSchema.safeParse({ ...rule, setAt: '2026-11-11' }).success).toBe(false);
  });

  it('acepta el historial con la regla por defecto, también vacío', () => {
    const body = { items: [rule], default: { threshold: 3, period: 'FORTNIGHT' } };

    expect(LatenessRulesSchema.parse(body)).toEqual(body);
    expect(LatenessRulesSchema.safeParse({ ...body, items: [] }).success).toBe(true);
  });

  it('exige la regla por defecto', () => {
    expect(LatenessRulesSchema.safeParse({ items: [] }).success).toBe(false);
  });
});

describe('attendanceLatenessRuleRoutes', () => {
  it('definir exige attendance.shifts:manage y listar attendance.shifts:read, por empresa', () => {
    expect(attendanceLatenessRuleRoutes.setLatenessRule.access).toEqual({
      kind: 'permission',
      permission: 'attendance.shifts:manage',
      companyParam: 'companyId',
    });
    expect(attendanceLatenessRuleRoutes.listLatenessRules.access).toEqual({
      kind: 'permission',
      permission: 'attendance.shifts:read',
      companyParam: 'companyId',
    });
  });

  it('declara métodos, rutas, estado de éxito y errores', () => {
    expect(attendanceLatenessRuleRoutes.setLatenessRule).toMatchObject({
      method: 'PUT',
      path: '/companies/:companyId/attendance/lateness-rules/:effectiveFrom',
      successStatus: 204,
      errors: ['COMPANY_NOT_FOUND', 'LATENESS_RULE_IN_PAST'],
    });
    expect(attendanceLatenessRuleRoutes.listLatenessRules).toMatchObject({
      method: 'GET',
      path: '/companies/:companyId/attendance/lateness-rules',
      errors: ['COMPANY_NOT_FOUND'],
    });
  });

  it('los parámetros exigen uuid y fecha ISO, y el cuerpo es el de la regla', () => {
    const { setLatenessRule, listLatenessRules } = attendanceLatenessRuleRoutes;
    const companyId = '00000000-0000-4000-8000-0000000000c1';

    expect(
      setLatenessRule.params.safeParse({ companyId, effectiveFrom: '2026-11-16' }).success,
    ).toBe(true);
    expect(
      setLatenessRule.params.safeParse({ companyId: 'x', effectiveFrom: '2026-11-16' }).success,
    ).toBe(false);
    expect(setLatenessRule.params.safeParse({ companyId, effectiveFrom: 'mañana' }).success).toBe(
      false,
    );
    expect(setLatenessRule.body).toBe(SetLatenessRuleSchema);
    expect(listLatenessRules.params.safeParse({ companyId: 'x' }).success).toBe(false);
    expect(listLatenessRules.response).toBe(LatenessRulesSchema);
  });

  it('el catálogo de errores tiene LATENESS_RULE_IN_PAST como 422 con ejemplo', () => {
    expect(API_ERRORS.LATENESS_RULE_IN_PAST.status).toBe(422);
    expect(API_ERRORS.LATENESS_RULE_IN_PAST.examples.default).toMatchObject({
      code: 'LATENESS_RULE_IN_PAST',
      details: { effectiveFrom: expect.any(String), today: expect.any(String) },
    });
  });
});

describe('ABSENT_LATENESS en la jornada', () => {
  it('WorkdaySchema acepta el estado y conserva los minutos de retardo', () => {
    const workday = {
      date: '2026-11-05',
      shiftId: '00000000-0000-4000-8000-0000000000a1',
      shiftName: 'Oficina',
      status: 'ABSENT_LATENESS',
      scheduledStartAt: '2026-11-05T14:00:00.000Z',
      scheduledEndAt: '2026-11-05T23:00:00.000Z',
      scheduledMinutes: 480,
      firstPunchAt: '2026-11-05T14:30:00.000Z',
      lastPunchAt: '2026-11-05T23:00:00.000Z',
      punchCount: 2,
      lateMinutes: 30,
      workedMinutes: 480,
      overtimeMinutes: 0,
      calculatedAt: '2026-12-01T12:00:00.000Z',
    };

    expect(WorkdaySchema.parse(workday)).toEqual(workday);
  });
});
