import { Email, NationalId, type CountryCode } from '@rrhh/domain';

import type { Employee as EmployeeRow } from '@/infrastructure/database/generated/client';

import { Employee, type EmployeeId } from '../domain/employee';

export const EmployeeMapper = {
  toDomain(row: EmployeeRow): Employee {
    const nationalId = NationalId.create(
      row.nationalIdCountry as CountryCode,
      row.nationalIdNumber,
    );
    const email = Email.create(row.email);
    if (!nationalId.ok) throw nationalId.error;
    if (!email.ok) throw email.error;

    return Employee.restore(row.id as EmployeeId, {
      companyId: row.companyId,
      nationalId: nationalId.value,
      firstName: row.firstName,
      lastName: row.lastName,
      email: email.value,
      positionTitle: row.positionTitle,
      hireDate: row.hireDate,
      status: row.status,
    });
  },

  toPersistence(employee: Employee) {
    const s = employee.snapshot;
    return {
      id: employee.id,
      companyId: s.companyId,
      nationalIdCountry: s.nationalId.country,
      nationalIdNumber: s.nationalId.value,
      firstName: s.firstName,
      lastName: s.lastName,
      email: s.email.value,
      positionTitle: s.positionTitle,
      hireDate: s.hireDate,
      status: s.status,
    };
  },
};
