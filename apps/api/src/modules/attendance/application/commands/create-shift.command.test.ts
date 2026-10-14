import { describe, expect, it } from 'vitest';

import { FixedClock, SequentialIdGenerator } from '@/shared/testing/fakes';

import {
  InMemoryShiftRepository,
  InMemoryShiftStore,
} from '../../infrastructure/in-memory/in-memory-shift.store';

import { CreateShift } from './create-shift.command';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_COMPANY = '00000000-0000-4000-8000-0000000000c2';
const NOW = new Date('2026-10-14T12:00:00Z');

function setUp() {
  const shiftRepository = new InMemoryShiftRepository(new InMemoryShiftStore());
  const command = new CreateShift({
    shiftRepository,
    shiftCompanyDirectory: {
      exists: (id: string) => Promise.resolve(id === COMPANY || id === OTHER_COMPANY),
    },
    idGenerator: new SequentialIdGenerator(),
    clock: new FixedClock(NOW),
  });
  return { command, shiftRepository };
}

const input = {
  companyId: COMPANY,
  name: 'Oficina',
  cycleStartDate: '2026-11-02',
  toleranceMinutes: 10,
  days: [
    { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 },
    { type: 'REST' },
  ] as const,
};

describe('CreateShift', () => {
  it('crea el turno, lo persiste activo con la hora del reloj y devuelve su id', async () => {
    const { command, shiftRepository } = setUp();

    const result = await command.execute(input);

    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const saved = await shiftRepository.findById(result.value.id);
    expect(saved?.name).toBe('Oficina');
    expect(saved?.companyId).toBe(COMPANY);
    expect(saved?.active).toBe(true);
    expect(saved?.createdAt).toEqual(NOW);
    expect(saved?.days).toEqual(input.days);
  });

  it('empresa inexistente: COMPANY_NOT_FOUND y no persiste nada', async () => {
    const { command } = setUp();

    const result = await command.execute({
      ...input,
      companyId: '00000000-0000-4000-8000-0000000000ff',
    });

    expect(!result.ok && result.error.code).toBe('COMPANY_NOT_FOUND');
  });

  it('mismo nombre en otra capitalización y misma empresa: SHIFT_ALREADY_EXISTS', async () => {
    const { command } = setUp();
    await command.execute(input);

    const result = await command.execute({ ...input, name: '  OFICINA ' });

    expect(!result.ok && result.error.code).toBe('SHIFT_ALREADY_EXISTS');
  });

  it('el mismo nombre en otra empresa se permite', async () => {
    const { command } = setUp();
    await command.execute(input);

    const result = await command.execute({ ...input, companyId: OTHER_COMPANY });

    expect(result.ok).toBe(true);
  });

  it('un ciclo inválido llega como INVALID_VALUE (el dominio revalida el contrato)', async () => {
    const { command } = setUp();

    const result = await command.execute({ ...input, days: [{ type: 'REST' }] });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
  });
});
