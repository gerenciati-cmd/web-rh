import { describe, expect, it } from 'vitest';

import {
  InMemoryShiftQueries,
  InMemoryShiftStore,
} from '../../infrastructure/in-memory/in-memory-shift.store';

import { ListEmployeeShiftAssignments } from './list-employee-shift-assignments.query';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_COMPANY = '00000000-0000-4000-8000-0000000000c2';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';

function setUp() {
  return new ListEmployeeShiftAssignments({
    shiftQueries: new InMemoryShiftQueries(new InMemoryShiftStore()),
    shiftEmployeeDirectory: {
      find: (id: string) =>
        Promise.resolve(id === EMPLOYEE ? { id, companyId: COMPANY, active: true } : null),
    },
  });
}

describe('ListEmployeeShiftAssignments', () => {
  it('colaborador de la empresa sin historial: página vacía, no 404', async () => {
    const result = await setUp().execute({
      companyId: COMPANY,
      employeeId: EMPLOYEE,
      page: 1,
      pageSize: 20,
    });

    expect(result.ok && result.value).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('colaborador inexistente: EMPLOYEE_NOT_FOUND', async () => {
    const result = await setUp().execute({
      companyId: COMPANY,
      employeeId: '00000000-0000-4000-8000-0000000000ff',
      page: 1,
      pageSize: 20,
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('colaborador de otra empresa: EMPLOYEE_NOT_FOUND', async () => {
    const result = await setUp().execute({
      companyId: OTHER_COMPANY,
      employeeId: EMPLOYEE,
      page: 1,
      pageSize: 20,
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });
});
