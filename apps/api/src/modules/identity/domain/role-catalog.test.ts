import { PERMISSIONS, ROLES } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { grantsFor, ROLE_DEFINITIONS } from './role-catalog';

describe('ROLE_DEFINITIONS', () => {
  it('define exactamente los roles del vocabulario compartido', () => {
    expect(Object.keys(ROLE_DEFINITIONS).sort()).toEqual([...ROLES].sort());
  });

  it('HOLDING_ADMIN: alcance holding, todos los permisos, asignable', () => {
    expect(ROLE_DEFINITIONS.HOLDING_ADMIN).toEqual({
      scope: 'HOLDING',
      permissions: PERMISSIONS,
      assignable: true,
    });
  });

  it('HR: alcance empresa, solo lo relativo a colaboradores y ver empresas, asignable', () => {
    expect(ROLE_DEFINITIONS.HR.scope).toBe('COMPANY');
    expect(ROLE_DEFINITIONS.HR.assignable).toBe(true);
    expect([...ROLE_DEFINITIONS.HR.permissions].sort()).toEqual(
      ['employees:read', 'employees:register', 'organization.companies:read'].sort(),
    );
  });

  it('DIRECT_MANAGER y EMPLOYEE son inertes: no conceden nada y no se pueden asignar', () => {
    expect(ROLE_DEFINITIONS.DIRECT_MANAGER).toEqual({
      scope: 'TEAM',
      permissions: [],
      assignable: false,
    });
    expect(ROLE_DEFINITIONS.EMPLOYEE).toEqual({
      scope: 'SELF',
      permissions: [],
      assignable: false,
    });
  });
});

describe('grantsFor', () => {
  it('sin asignaciones: sin concesiones', () => {
    expect(grantsFor([])).toEqual([]);
  });

  it('HOLDING_ADMIN sin empresa: una concesión de holding (null) por permiso', () => {
    const grants = grantsFor([{ role: 'HOLDING_ADMIN', companyId: null }]);

    expect(grants).toHaveLength(PERMISSIONS.length);
    expect(grants.every((grant) => grant.companyId === null)).toBe(true);
    expect(grants.map((grant) => grant.permission).sort()).toEqual([...PERMISSIONS].sort());
  });

  it('HR en una empresa: sus permisos quedan atados a esa empresa', () => {
    const grants = grantsFor([{ role: 'HR', companyId: 'company-a' }]);

    expect(grants).toHaveLength(3);
    expect(grants.every((grant) => grant.companyId === 'company-a')).toBe(true);
    expect(grants.map((grant) => grant.permission)).not.toContain('organization.companies:create');
  });

  it('varias asignaciones se acumulan', () => {
    const grants = grantsFor([
      { role: 'HR', companyId: 'company-a' },
      { role: 'HR', companyId: 'company-b' },
    ]);

    expect(grants).toHaveLength(6);
    expect(new Set(grants.map((grant) => grant.companyId))).toEqual(
      new Set(['company-a', 'company-b']),
    );
  });

  it('roles inertes no aportan concesiones', () => {
    expect(
      grantsFor([
        { role: 'DIRECT_MANAGER', companyId: null },
        { role: 'EMPLOYEE', companyId: null },
      ]),
    ).toEqual([]);
  });
});
