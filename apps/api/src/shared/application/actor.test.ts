import { describe, expect, it } from 'vitest';

import { companiesWith, hasPermission, type Actor, type Grant } from './actor';

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

function actorWith(...grants: Grant[]): Actor {
  return { userId: 'user-1', sessionId: 'session-1', grants };
}

describe('hasPermission', () => {
  it('sin concesiones: niega todo', () => {
    expect(hasPermission(actorWith(), 'employees:read')).toBe(false);
    expect(hasPermission(actorWith(), 'employees:read', COMPANY_A)).toBe(false);
  });

  it('sin companyId: basta cualquier concesión de ese permiso, sea del holding o de una empresa', () => {
    const holding = actorWith({ permission: 'employees:read', companyId: null });
    const scoped = actorWith({ permission: 'employees:read', companyId: COMPANY_A });

    expect(hasPermission(holding, 'employees:read')).toBe(true);
    expect(hasPermission(scoped, 'employees:read')).toBe(true);
  });

  it('un permiso distinto no se concede por tener otro', () => {
    const actor = actorWith({ permission: 'employees:read', companyId: null });

    expect(hasPermission(actor, 'employees:register')).toBe(false);
  });

  it('con companyId: una concesión del holding (null) cubre cualquier empresa', () => {
    const actor = actorWith({ permission: 'employees:read', companyId: null });

    expect(hasPermission(actor, 'employees:read', COMPANY_A)).toBe(true);
    expect(hasPermission(actor, 'employees:read', COMPANY_B)).toBe(true);
  });

  it('con companyId: una concesión de empresa solo cubre esa empresa', () => {
    const actor = actorWith({ permission: 'employees:read', companyId: COMPANY_A });

    expect(hasPermission(actor, 'employees:read', COMPANY_A)).toBe(true);
    expect(hasPermission(actor, 'employees:read', COMPANY_B)).toBe(false);
  });

  it('con companyId: el permiso también debe coincidir en la concesión de esa empresa', () => {
    const actor = actorWith(
      { permission: 'employees:read', companyId: COMPANY_A },
      { permission: 'employees:register', companyId: COMPANY_B },
    );

    expect(hasPermission(actor, 'employees:register', COMPANY_A)).toBe(false);
    expect(hasPermission(actor, 'employees:register', COMPANY_B)).toBe(true);
  });
});

describe('companiesWith', () => {
  it('sin concesiones de ese permiso: lista vacía', () => {
    const actor = actorWith({ permission: 'employees:read', companyId: null });

    expect(companiesWith(actor, 'organization.companies:read')).toEqual([]);
  });

  it("una concesión del holding devuelve 'ALL' aunque haya otras de empresa", () => {
    const actor = actorWith(
      { permission: 'organization.companies:read', companyId: COMPANY_A },
      { permission: 'organization.companies:read', companyId: null },
    );

    expect(companiesWith(actor, 'organization.companies:read')).toBe('ALL');
  });

  it('devuelve los ids distintos de las empresas (sin duplicar)', () => {
    const actor = actorWith(
      { permission: 'organization.companies:read', companyId: COMPANY_A },
      { permission: 'organization.companies:read', companyId: COMPANY_A },
      { permission: 'organization.companies:read', companyId: COMPANY_B },
      { permission: 'employees:read', companyId: 'company-c' },
    );

    expect(companiesWith(actor, 'organization.companies:read')).toEqual([COMPANY_A, COMPANY_B]);
  });
});
