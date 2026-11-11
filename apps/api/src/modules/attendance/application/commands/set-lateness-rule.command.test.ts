import { describe, expect, it } from 'vitest';

import { FixedClock } from '@/shared/testing/fakes';

import {
  InMemoryLatenessRuleQueries,
  InMemoryLatenessRuleRepository,
  InMemoryLatenessRuleStore,
} from '../../infrastructure/in-memory/in-memory-lateness-rule.store';

import { SetLatenessRule } from './set-lateness-rule.command';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_COMPANY = '00000000-0000-4000-8000-0000000000c2';
const MISSING_COMPANY = '00000000-0000-4000-8000-0000000000ff';
const USER = '00000000-0000-4000-8000-0000000000b1';
const NOW = new Date('2026-11-11T12:00:00Z');

function setUp(now = NOW) {
  const store = new InMemoryLatenessRuleStore();
  const latenessRuleRepository = new InMemoryLatenessRuleRepository(store);
  const command = new SetLatenessRule({
    latenessRuleRepository,
    shiftCompanyDirectory: {
      exists: (id: string) => Promise.resolve(id === COMPANY || id === OTHER_COMPANY),
    },
    clock: new FixedClock(now),
  });
  return { command, latenessRuleRepository, queries: new InMemoryLatenessRuleQueries(store) };
}

const input = {
  companyId: COMPANY,
  effectiveFrom: '2026-11-16',
  threshold: 4,
  period: 'WEEK' as const,
  setBy: USER,
};

describe('SetLatenessRule', () => {
  it('guarda la regla con la hora del reloj y quién la definió', async () => {
    const { command, latenessRuleRepository } = setUp();

    const result = await command.execute(input);

    expect(result.ok).toBe(true);
    expect(await latenessRuleRepository.listByCompany(COMPANY)).toEqual([
      {
        companyId: COMPANY,
        effectiveFrom: '2026-11-16',
        threshold: 4,
        period: 'WEEK',
        setAt: NOW,
        setBy: USER,
      },
    ]);
  });

  it('empresa inexistente: COMPANY_NOT_FOUND y no guarda nada', async () => {
    const { command, latenessRuleRepository } = setUp();

    const result = await command.execute({ ...input, companyId: MISSING_COMPANY });

    expect(!result.ok && result.error.code).toBe('COMPANY_NOT_FOUND');
    expect(await latenessRuleRepository.listByCompany(MISSING_COMPANY)).toEqual([]);
  });

  it('fecha anterior a hoy (UTC): LATENESS_RULE_IN_PAST con effectiveFrom y today, y no guarda', async () => {
    const { command, latenessRuleRepository } = setUp();

    const result = await command.execute({ ...input, effectiveFrom: '2026-11-10' });

    expect(!result.ok && result.error.code).toBe('LATENESS_RULE_IN_PAST');
    expect(!result.ok && result.error.details).toEqual({
      effectiveFrom: '2026-11-10',
      today: '2026-11-11',
    });
    expect(await latenessRuleRepository.listByCompany(COMPANY)).toEqual([]);
  });

  it('la fecha de hoy se acepta (inclusive)', async () => {
    const { command, latenessRuleRepository } = setUp();

    const result = await command.execute({ ...input, effectiveFrom: '2026-11-11' });

    expect(result.ok).toBe(true);
    expect(await latenessRuleRepository.listByCompany(COMPANY)).toHaveLength(1);
  });

  it('"hoy" es la fecha UTC del reloj, no la local: a las 23:30 UTC sigue siendo el mismo día', async () => {
    const { command } = setUp(new Date('2026-11-11T23:30:00Z'));

    const today = await command.execute({ ...input, effectiveFrom: '2026-11-11' });
    const yesterday = await command.execute({ ...input, effectiveFrom: '2026-11-10' });

    expect(today.ok).toBe(true);
    expect(!yesterday.ok && yesterday.error.code).toBe('LATENESS_RULE_IN_PAST');
  });

  it('repetir la misma fecha reemplaza la regla: queda una sola con los valores nuevos', async () => {
    const { command, latenessRuleRepository } = setUp();
    await command.execute(input);

    const result = await command.execute({ ...input, threshold: 2, period: 'MONTH' });

    expect(result.ok).toBe(true);
    const rules = await latenessRuleRepository.listByCompany(COMPANY);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ threshold: 2, period: 'MONTH' });
  });

  it('fechas distintas conservan el historial, y las reglas de otra empresa no se mezclan', async () => {
    const { command, latenessRuleRepository } = setUp();
    await command.execute(input);
    await command.execute({ ...input, effectiveFrom: '2026-12-01', threshold: 5 });
    await command.execute({ ...input, companyId: OTHER_COMPANY });

    const rules = await latenessRuleRepository.listByCompany(COMPANY);

    expect(rules.map((rule) => rule.effectiveFrom)).toEqual(['2026-11-16', '2026-12-01']);
    expect(await latenessRuleRepository.listByCompany(OTHER_COMPANY)).toHaveLength(1);
  });
});
