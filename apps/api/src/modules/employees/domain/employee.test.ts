import { Email, NationalId, PersonalRfc } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import {
  Employee,
  EMPLOYEE_HIRED,
  EMPLOYEE_RFC_ASSIGNED,
  EMPLOYEE_SITE_ASSIGNED,
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

    it('assignRfc no registra evento si el RFC no cambia', () => {
      const hired = hire();
      if (!hired.ok) throw hired.error;
      hired.value.pullEvents();

      expect(hired.value.assignRfc(rfcOf('GOMA850101AB1'), now).ok).toBe(true);

      expect(hired.value.pullEvents()).toEqual([]);
    });

    it('assignRfc rechaza con RFC_NOT_APPLICABLE a un colaborador que no es de México', () => {
      const hired = hire({ nationalId: doId.value, rfc: undefined });
      if (!hired.ok) throw hired.error;

      const result = hired.value.assignRfc(rfcOf('GOMA850101AB1'), now);

      expect(!result.ok && result.error.code).toBe('RFC_NOT_APPLICABLE');
      expect(hired.value.snapshot.rfc).toBeNull();
    });
  });

  describe('sede', () => {
    const hiredEmployee = () => {
      const result = hire();
      if (!result.ok) throw result.error;
      result.value.pullEvents();
      return result.value;
    };

    it('guarda la sede en el snapshot al contratar', () => {
      const result = hire({ siteId: 'site-9' });
      expect(result.ok && result.value.snapshot.siteId).toBe('site-9');
    });

    it('assignSite cambia la sede y registra EMPLOYEE_SITE_ASSIGNED con la sede previa', () => {
      const employee = hiredEmployee();

      employee.assignSite('site-2', now);

      expect(employee.snapshot.siteId).toBe('site-2');
      const events = employee.pullEvents();
      expect(events.map((e) => e.name)).toEqual([EMPLOYEE_SITE_ASSIGNED]);
      expect(events[0]?.payload).toEqual({
        employeeId: 'emp-1',
        siteId: 'site-2',
        previousSiteId: 'site-1',
      });
    });

    it('assignSite a una fila sin sede registra previousSiteId null', () => {
      const source = hiredEmployee();
      const employee = Employee.restore(source.id, { ...source.snapshot, siteId: null });

      employee.assignSite('site-2', now);

      expect(employee.snapshot.siteId).toBe('site-2');
      expect(employee.pullEvents()[0]?.payload).toMatchObject({ previousSiteId: null });
    });

    it('assignSite con la misma sede no cambia nada ni registra evento', () => {
      const employee = hiredEmployee();

      employee.assignSite('site-1', now);

      expect(employee.snapshot.siteId).toBe('site-1');
      expect(employee.pullEvents()).toEqual([]);
    });
  });

  describe('terminate', () => {
    it('desvincula y registra el evento', () => {
      const result = hire();
      if (!result.ok) throw result.error;
      const employee = result.value;
      employee.pullEvents();

      expect(
        employee.terminate({ date: new Date('2026-01-10'), reason: 'VOLUNTARY_RESIGNATION' }, now)
          .ok,
      ).toBe(true);
      expect(employee.snapshot.status).toBe('TERMINATED');
      expect(employee.pullEvents().map((e) => e.name)).toEqual([EMPLOYEE_TERMINATED]);
    });

    it('no desvincula antes de la fecha de contratación', () => {
      const result = hire();
      if (!result.ok) throw result.error;
      expect(
        result.value.terminate(
          { date: new Date('2025-12-01'), reason: 'VOLUNTARY_RESIGNATION' },
          now,
        ).ok,
      ).toBe(false);
    });

    it('no desvincula dos veces', () => {
      const result = hire();
      if (!result.ok) throw result.error;
      result.value.terminate(
        { date: new Date('2026-01-10'), reason: 'VOLUNTARY_RESIGNATION' },
        now,
      );
      expect(
        result.value.terminate(
          { date: new Date('2026-01-12'), reason: 'VOLUNTARY_RESIGNATION' },
          now,
        ).ok,
      ).toBe(false);
    });

    const hired = () => {
      const result = hire();
      if (!result.ok) throw result.error;
      result.value.pullEvents();
      return result.value;
    };

    it('al contratar no tiene baja registrada', () => {
      expect(hired().snapshot.termination).toBeNull();
    });

    it('guarda la fecha y el motivo de la baja', () => {
      const employee = hired();

      employee.terminate({ date: new Date('2026-01-10'), reason: 'DISMISSAL_WITH_CAUSE' }, now);

      expect(employee.snapshot.termination).toEqual({
        date: new Date('2026-01-10'),
        reason: 'DISMISSAL_WITH_CAUSE',
      });
    });

    it('el evento conserva el payload { employeeId, terminationDate } sin el motivo', () => {
      const employee = hired();

      employee.terminate({ date: new Date('2026-01-10'), reason: 'OTHER' }, now);

      const [event] = employee.pullEvents();
      expect(event?.payload).toEqual({
        employeeId: 'emp-1',
        terminationDate: new Date('2026-01-10'),
      });
      expect(event?.occurredAt).toEqual(now);
    });

    it('acepta la fecha de hoy (UTC) aunque ya haya pasado la medianoche', () => {
      const employee = hired();

      const result = employee.terminate(
        { date: new Date('2026-01-15T00:00:00Z'), reason: 'END_OF_CONTRACT' },
        now,
      );

      expect(result.ok).toBe(true);
    });

    it('acepta la baja el mismo día de la contratación', () => {
      const employee = hired();

      const result = employee.terminate(
        { date: new Date('2026-01-01'), reason: 'MUTUAL_AGREEMENT' },
        now,
      );

      expect(result.ok).toBe(true);
    });

    it('TERMINATION_DATE_IN_FUTURE si la fecha es posterior a hoy, sin desvincular', () => {
      const employee = hired();

      const result = employee.terminate(
        { date: new Date('2026-01-16T00:00:00Z'), reason: 'VOLUNTARY_RESIGNATION' },
        now,
      );

      expect(!result.ok && result.error.code).toBe('TERMINATION_DATE_IN_FUTURE');
      expect(employee.snapshot.status).toBe('ACTIVE');
      expect(employee.snapshot.termination).toBeNull();
      expect(employee.pullEvents()).toEqual([]);
    });

    it('TERMINATION_BEFORE_HIRE con la fecha de contratación en details', () => {
      const employee = hired();

      const result = employee.terminate(
        { date: new Date('2025-12-31'), reason: 'VOLUNTARY_RESIGNATION' },
        now,
      );

      expect(!result.ok && result.error.code).toBe('TERMINATION_BEFORE_HIRE');
      expect(!result.ok && result.error.details).toEqual({ hireDate: '2026-01-01' });
      expect(employee.snapshot.status).toBe('ACTIVE');
    });

    it('EMPLOYEE_ALREADY_TERMINATED en la segunda baja, sin cambiar la primera ni emitir evento', () => {
      const employee = hired();
      employee.terminate({ date: new Date('2026-01-10'), reason: 'DEATH' }, now);
      employee.pullEvents();

      const result = employee.terminate({ date: new Date('2026-01-12'), reason: 'OTHER' }, now);

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_TERMINATED');
      expect(!result.ok && result.error.details).toEqual({ employeeId: 'emp-1' });
      expect(employee.snapshot.termination).toEqual({
        date: new Date('2026-01-10'),
        reason: 'DEATH',
      });
      expect(employee.pullEvents()).toEqual([]);
    });

    it('ya desvinculado gana sobre la fecha futura (orden de las reglas)', () => {
      const employee = hired();
      employee.terminate({ date: new Date('2026-01-10'), reason: 'DEATH' }, now);

      const result = employee.terminate({ date: new Date('2026-03-01'), reason: 'OTHER' }, now);

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_TERMINATED');
    });

    it('fecha futura gana sobre anterior a la contratación (orden de las reglas)', () => {
      const result = hire({ hireDate: new Date('2026-03-01'), now });
      if (!result.ok) throw result.error;

      const terminated = result.value.terminate(
        { date: new Date('2026-02-01'), reason: 'OTHER' },
        now,
      );

      expect(!terminated.ok && terminated.error.code).toBe('TERMINATION_DATE_IN_FUTURE');
    });

    it('restore sin termination (fila anterior al campo) queda con termination null', () => {
      const employee = hired();
      const { termination: _omitted, ...props } = employee.snapshot;

      const restored = Employee.restore(employee.id, { ...props, status: 'TERMINATED' });

      expect(restored.snapshot.termination).toBeNull();
      expect(restored.snapshot.status).toBe('TERMINATED');
    });
  });

  describe('desvinculado no se edita (employees-desvinculacion/002)', () => {
    const terminated = () => {
      const result = hire();
      if (!result.ok) throw result.error;
      const employee = result.value;
      employee.terminate({ date: new Date('2026-01-10'), reason: 'OTHER' }, now);
      employee.pullEvents();
      return employee;
    };
    const rfc = (raw: string) => {
      const value = PersonalRfc.create(raw);
      if (!value.ok) throw value.error;
      return value.value;
    };

    it('assignSite → EMPLOYEE_INACTIVE con employeeId, sin cambiar la sede ni registrar evento', () => {
      const employee = terminated();

      const result = employee.assignSite('site-2', now);

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_INACTIVE');
      expect(!result.ok && result.error.details).toEqual({ employeeId: 'emp-1' });
      expect(employee.snapshot.siteId).toBe('site-1');
      expect(employee.pullEvents()).toEqual([]);
    });

    it('assignSite con la misma sede también se rechaza', () => {
      expect(terminated().assignSite('site-1', now).ok).toBe(false);
    });

    it('assignRfc → EMPLOYEE_INACTIVE, sin cambiar el RFC ni registrar evento', () => {
      const employee = terminated();

      const result = employee.assignRfc(rfc('GOMA850101AB9'), now);

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_INACTIVE');
      expect(employee.snapshot.rfc?.value).toBe('GOMA850101AB1');
      expect(employee.pullEvents()).toEqual([]);
    });

    it('assignRfc revisa la baja antes que el país (desvinculado de otro país → EMPLOYEE_INACTIVE)', () => {
      const doId = NationalId.create('DO', '00113918205');
      if (!doId.ok) throw doId.error;
      const result = hire({ nationalId: doId.value, rfc: undefined });
      if (!result.ok) throw result.error;
      result.value.terminate({ date: new Date('2026-01-10'), reason: 'OTHER' }, now);

      const assigned = result.value.assignRfc(rfc('GOMA850101AB1'), now);

      expect(!assigned.ok && assigned.error.code).toBe('EMPLOYEE_INACTIVE');
    });

    it('un activo sigue pudiendo cambiar sede y RFC (assignSite devuelve ok)', () => {
      const result = hire();
      if (!result.ok) throw result.error;

      expect(result.value.assignSite('site-2', now).ok).toBe(true);
      expect(result.value.assignRfc(rfc('GOMA850101AB9'), now).ok).toBe(true);
    });
  });
});
