import { describe, expect, it } from 'vitest';

import {
  InMemoryLatenessRuleQueries,
  InMemoryLatenessRuleRepository,
  InMemoryLatenessRuleStore,
} from '../../infrastructure/in-memory/in-memory-lateness-rule.store';

import { ListLatenessRules } from './list-lateness-rules.query';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_COMPANY = '00000000-0000-4000-8000-0000000000c2';
const MISSING_COMPANY = '00000000-0000-4000-8000-0000000000ff';
const USER = '00000000-0000-4000-8000-0000000000b1';
const SET_AT = new Date('2026-11-11T12:00:00Z');

function setUp() {
  const store = new InMemoryLatenessRuleStore();
  const repository = new InMemoryLatenessRuleRepository(store);
  const query = new ListLatenessRules({
    latenessRuleQueries: new InMemoryLatenessRuleQueries(store),
    shiftCompanyDirectory: {
      exists: (id: string) => Promise.resolve(id === COMPANY || id === OTHER_COMPANY),
    },
  });
  return { query, repository };
}

describe('ListLatenessRules', () => {
  it('empresa sin reglas: lista vacía y la regla por defecto de 3 por quincena', async () => {
    const { query } = setUp();

    const result = await query.execute({ companyId: COMPANY });

    expect(result.ok && result.value).toEqual({
      items: [],
      default: { threshold: 3, period: 'FORTNIGHT' },
    });
  });

  it('lista el historial de la más reciente a la más antigua, solo el de la empresa', async () => {
    const { query, repository } = setUp();
    await repository.put({
      companyId: COMPANY,
      effectiveFrom: '2026-11-16',
      threshold: 2,
      period: 'WEEK',
      setAt: SET_AT,
      setBy: USER,
    });
    await repository.put({
      companyId: COMPANY,
      effectiveFrom: '2026-12-01',
      threshold: 5,
      period: 'MONTH',
      setAt: SET_AT,
      setBy: USER,
    });
    await repository.put({
      companyId: OTHER_COMPANY,
      effectiveFrom: '2026-11-20',
      threshold: 9,
      period: 'MONTH',
      setAt: SET_AT,
      setBy: USER,
    });

    const result = await query.execute({ companyId: COMPANY });

    expect(result.ok && result.value.items).toEqual([
      { effectiveFrom: '2026-12-01', threshold: 5, period: 'MONTH', setAt: SET_AT.toISOString() },
      { effectiveFrom: '2026-11-16', threshold: 2, period: 'WEEK', setAt: SET_AT.toISOString() },
    ]);
  });

  it('empresa inexistente: COMPANY_NOT_FOUND', async () => {
    const { query } = setUp();

    const result = await query.execute({ companyId: MISSING_COMPANY });

    expect(!result.ok && result.error.code).toBe('COMPANY_NOT_FOUND');
  });
});
