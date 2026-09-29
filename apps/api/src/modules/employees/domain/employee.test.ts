import { Email, NationalId } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { Employee, EMPLOYEE_HIRED, EMPLOYEE_TERMINATED, type EmployeeId } from './employee';

const now = new Date('2026-01-15T12:00:00Z');

function hire(overrides: Partial<Parameters<typeof Employee.hire>[0]> = {}) {
  const nationalId = NationalId.create('MX', 'GOMA850101HQRRRN04');
  const email = Email.create('ana@aps.cl');
  if (!nationalId.ok || !email.ok) throw new Error('fixture inválido');

  return Employee.hire({
    id: 'emp-1' as EmployeeId,
    companyId: 'company-1',
    nationalId: nationalId.value,
    firstName: 'Ana',
    lastName: 'Rojas',
    email: email.value,
    hireDate: new Date('2026-01-01'),
    now,
    ...overrides,
  });
}

describe('Employee', () => {
  it('se contrata en estado ACTIVE y registra EMPLOYEE_HIRED', () => {
    const result = hire();
    expect(result.ok && result.value.snapshot.status).toBe('ACTIVE');
    expect(result.ok && result.value.pullEvents().map((e) => e.name)).toEqual([EMPLOYEE_HIRED]);
  });

  it('no permite contratar con más de 90 días de anticipación', () => {
    const result = hire({ hireDate: new Date('2026-06-01') });
    expect(!result.ok && result.error.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('exige nombre y apellido', () => {
    expect(hire({ firstName: '   ' }).ok).toBe(false);
  });

  describe('terminate', () => {
    it('desvincula y registra el evento', () => {
      const result = hire();
      if (!result.ok) throw result.error;
      const employee = result.value;
      employee.pullEvents();

      expect(employee.terminate(new Date('2026-02-01'), now).ok).toBe(true);
      expect(employee.snapshot.status).toBe('TERMINATED');
      expect(employee.pullEvents().map((e) => e.name)).toEqual([EMPLOYEE_TERMINATED]);
    });

    it('no desvincula antes de la fecha de contratación', () => {
      const result = hire();
      if (!result.ok) throw result.error;
      expect(result.value.terminate(new Date('2025-12-01'), now).ok).toBe(false);
    });

    it('no desvincula dos veces', () => {
      const result = hire();
      if (!result.ok) throw result.error;
      result.value.terminate(new Date('2026-02-01'), now);
      expect(result.value.terminate(new Date('2026-02-02'), now).ok).toBe(false);
    });
  });
});
