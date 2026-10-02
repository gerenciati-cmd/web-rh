import { Email, NationalId, PersonalRfc } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import {
  Employee,
  EMPLOYEE_HIRED,
  EMPLOYEE_RFC_ASSIGNED,
  EMPLOYEE_TERMINATED,
  type EmployeeId,
} from './employee';

const now = new Date('2026-01-15T12:00:00Z');

function hire(overrides: Partial<Parameters<typeof Employee.hire>[0]> = {}) {
  const nationalId = NationalId.create('MX', 'GOMA850101HQRRRN04');
  const email = Email.create('ana@aps.cl');
  const rfc = PersonalRfc.create('GOMA850101AB1');
  if (!nationalId.ok || !email.ok || !rfc.ok) throw new Error('fixture inválido');

  return Employee.hire({
    id: 'emp-1' as EmployeeId,
    companyId: 'company-1',
    nationalId: nationalId.value,
    rfc: rfc.value,
    siteId: 'site-1',
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

  describe('RFC', () => {
    const doId = NationalId.create('DO', '00113918205');
    const rfcOf = (raw: string) => {
      const rfc = PersonalRfc.create(raw);
      if (!rfc.ok) throw new Error('fixture inválido');
      return rfc.value;
    };
    if (!doId.ok) throw new Error('fixture inválido');

    it('guarda el RFC en el snapshot al contratar en México', () => {
      const result = hire();
      expect(result.ok && result.value.snapshot.rfc?.value).toBe('GOMA850101AB1');
    });

    it('exige RFC para un colaborador de México', () => {
      const result = hire({ rfc: undefined });
      expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
      expect(!result.ok && result.error.message).toBe(
        'El RFC es obligatorio para colaboradores de México',
      );
    });

    it('rechaza un RFC en un colaborador que no es de México', () => {
      const result = hire({ nationalId: doId.value });
      expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
      expect(!result.ok && result.error.message).toBe(
        'El RFC solo aplica a colaboradores de México',
      );
    });

    it('contrata sin RFC a un colaborador que no es de México y deja rfc en null', () => {
      const result = hire({ nationalId: doId.value, rfc: undefined });
      expect(result.ok && result.value.snapshot.rfc).toBeNull();
    });

    it('assignRfc captura el RFC de un colaborador restaurado sin RFC', () => {
      const hired = hire();
      if (!hired.ok) throw hired.error;
      const employee = Employee.restore(hired.value.id, { ...hired.value.snapshot, rfc: null });

      expect(employee.assignRfc(rfcOf('GOMA850101AB2'), now).ok).toBe(true);
      expect(employee.snapshot.rfc?.value).toBe('GOMA850101AB2');
    });

    it('assignRfc corrige un RFC ya capturado', () => {
      const hired = hire();
      if (!hired.ok) throw hired.error;

      expect(hired.value.assignRfc(rfcOf('GOMA850101AB9'), now).ok).toBe(true);
      expect(hired.value.snapshot.rfc?.value).toBe('GOMA850101AB9');
    });

    it('assignRfc registra EMPLOYEE_RFC_ASSIGNED al cambiar el RFC', () => {
      const hired = hire();
      if (!hired.ok) throw hired.error;
      hired.value.pullEvents();

      hired.value.assignRfc(rfcOf('GOMA850101AB9'), now);

      expect(hired.value.pullEvents().map((e) => e.name)).toEqual([EMPLOYEE_RFC_ASSIGNED]);
    });

    it('assignRfc rechaza con RFC_NOT_APPLICABLE a un colaborador que no es de México', () => {
      const hired = hire({ nationalId: doId.value, rfc: undefined });
      if (!hired.ok) throw hired.error;

      const result = hired.value.assignRfc(rfcOf('GOMA850101AB1'), now);

      expect(!result.ok && result.error.code).toBe('RFC_NOT_APPLICABLE');
      expect(hired.value.snapshot.rfc).toBeNull();
    });
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
