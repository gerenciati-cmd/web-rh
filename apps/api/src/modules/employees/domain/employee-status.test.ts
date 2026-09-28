import { EmployeeStatusSchema } from '@rrhh/contracts';
import { EMPLOYEE_STATUSES } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

describe('vocabulario compartido de estados', () => {
  it.each(EMPLOYEE_STATUSES)('el contrato acepta %s', (status) => {
    expect(EmployeeStatusSchema.parse(status)).toBe(status);
  });
  it('rechaza valores fuera del vocabulario', () => {
    expect(EmployeeStatusSchema.safeParse('UNKNOWN').success).toBe(false);
    expect(EmployeeStatusSchema.options).toEqual([...EMPLOYEE_STATUSES]);
  });
});
