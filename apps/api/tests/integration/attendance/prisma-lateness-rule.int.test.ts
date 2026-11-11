import { describe, expect, it } from 'vitest';

import type { LatenessRule } from '@/modules/attendance/domain/lateness-rule';
import { PrismaLatenessRuleQueries } from '@/modules/attendance/infrastructure/prisma-lateness-rule.queries';
import { PrismaLatenessRuleRepository } from '@/modules/attendance/infrastructure/prisma-lateness-rule.repository';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['attendance.lateness_rules']);
const repository = new PrismaLatenessRuleRepository({ database });
const queries = new PrismaLatenessRuleQueries({ database });

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_COMPANY = '00000000-0000-4000-8000-0000000000c2';
const USER = '00000000-0000-4000-8000-0000000000b1';
const SET_AT = new Date('2026-11-11T12:00:00.123Z');

function rule(effectiveFrom: string, overrides: Partial<LatenessRule> = {}): LatenessRule {
  return {
    companyId: COMPANY,
    effectiveFrom,
    threshold: 3,
    period: 'FORTNIGHT',
    setAt: SET_AT,
    setBy: USER,
    ...overrides,
  };
}

describe('PrismaLatenessRuleRepository', () => {
  it('guarda la regla con la fecha como DATE y la devuelve con todos sus campos', async () => {
    await repository.put(rule('2026-11-16', { threshold: 4, period: 'WEEK' }));

    const rows = await database.client.$queryRawUnsafe<{ effective_from: string }[]>(
      `SELECT effective_from::text AS effective_from FROM attendance.lateness_rules`,
    );
    expect(rows).toEqual([{ effective_from: '2026-11-16' }]);
    expect(await repository.listByCompany(COMPANY)).toEqual([
      rule('2026-11-16', { threshold: 4, period: 'WEEK' }),
    ]);
  });

  it('put de la misma empresa y fecha reemplaza la regla (upsert): una sola fila con los valores nuevos', async () => {
    await repository.put(rule('2026-11-16', { threshold: 2, period: 'WEEK' }));
    const later = new Date('2026-11-12T08:00:00.000Z');

    await repository.put(rule('2026-11-16', { threshold: 5, period: 'MONTH', setAt: later }));

    expect(await database.client.attendanceLatenessRule.count()).toBe(1);
    expect(await repository.listByCompany(COMPANY)).toEqual([
      rule('2026-11-16', { threshold: 5, period: 'MONTH', setAt: later }),
    ]);
  });

  it('la misma fecha en otra empresa es otra regla', async () => {
    await repository.put(rule('2026-11-16'));
    await repository.put(rule('2026-11-16', { companyId: OTHER_COMPANY, threshold: 7 }));

    expect(await database.client.attendanceLatenessRule.count()).toBe(2);
    expect((await repository.listByCompany(OTHER_COMPANY))[0]?.threshold).toBe(7);
  });

  it('listByCompany devuelve ascendente por effectiveFrom, sin importar el orden de inserción, y solo la empresa pedida', async () => {
    await repository.put(rule('2026-12-01'));
    await repository.put(rule('2026-11-16'));
    await repository.put(rule('2026-11-20', { companyId: OTHER_COMPANY }));
    await repository.put(rule('2027-01-04'));

    const list = await repository.listByCompany(COMPANY);

    expect(list.map((item) => item.effectiveFrom)).toEqual([
      '2026-11-16',
      '2026-12-01',
      '2027-01-04',
    ]);
  });

  it('una empresa sin reglas devuelve una lista vacía', async () => {
    expect(await repository.listByCompany(COMPANY)).toEqual([]);
  });

  it('un periodo desconocido en la columna es corrupción: falla en vez de devolverlo', async () => {
    await database.client.$executeRawUnsafe(
      `INSERT INTO attendance.lateness_rules (company_id, effective_from, threshold, period, set_at, set_by)
       VALUES ('${COMPANY}', '2026-11-16', 3, 'YEAR', now(), '${USER}')`,
    );

    await expect(repository.listByCompany(COMPANY)).rejects.toThrow('Periodo de regla');
  });
});

describe('PrismaLatenessRuleQueries', () => {
  it('lista de la más reciente a la más antigua como DTO con setAt ISO', async () => {
    await repository.put(rule('2026-11-16', { threshold: 2, period: 'WEEK' }));
    await repository.put(rule('2026-12-01', { threshold: 5, period: 'MONTH' }));

    const items = await queries.listByCompany(COMPANY);

    expect(items).toEqual([
      {
        effectiveFrom: '2026-12-01',
        threshold: 5,
        period: 'MONTH',
        setAt: '2026-11-11T12:00:00.123Z',
      },
      {
        effectiveFrom: '2026-11-16',
        threshold: 2,
        period: 'WEEK',
        setAt: '2026-11-11T12:00:00.123Z',
      },
    ]);
  });

  it('no mezcla empresas y devuelve vacío si no hay reglas', async () => {
    await repository.put(rule('2026-11-16', { companyId: OTHER_COMPANY }));

    expect(await queries.listByCompany(COMPANY)).toEqual([]);
  });
});
