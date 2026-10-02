import type { EmployeeListItem, Page } from '@rrhh/contracts';
import { NationalId, type CountryCode } from '@rrhh/domain';

import type { Prisma } from '@/infrastructure/database/generated/client';
import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type {
  EmployeeDirectoryFilters,
  EmployeeQueries,
  EmployeeRfcOwner,
  SiteMember,
} from '../application/queries/employee.queries';

/**
 * Lado lectura: consulta optimizada con `select` de solo lo que la vista necesita.
 * No construye agregados `Employee`: no hay invariantes que proteger al leer.
 */
export class PrismaEmployeeQueries implements EmployeeQueries {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async listDirectory(filters: EmployeeDirectoryFilters): Promise<Page<EmployeeListItem>> {
    const { companyId, status, search, page, pageSize } = filters;
    const where: Prisma.EmployeeWhereInput = {
      companyId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              // El documento se guarda normalizado (sin separadores, en mayúsculas): una CURP
              // escrita en minúsculas debe coincidir.
              { nationalIdNumber: { contains: search.replace(/[.\-\s]/g, '').toUpperCase() } },
            ],
          }
        : {}),
    };

    const db = this.deps.database.client;
    const [rows, total] = await Promise.all([
      db.employee.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          nationalIdCountry: true,
          nationalIdNumber: true,
          rfc: true,
          siteId: true,
          email: true,
          positionTitle: true,
          hireDate: true,
          status: true,
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.employee.count({ where }),
    ]);

    const items = rows.map((row) => {
      const nationalId = NationalId.create(
        row.nationalIdCountry as CountryCode,
        row.nationalIdNumber,
      );
      return {
        id: row.id,
        fullName: `${row.firstName} ${row.lastName}`,
        nationalId: nationalId.ok ? nationalId.value.format() : row.nationalIdNumber,
        rfc: row.rfc,
        siteId: row.siteId,
        email: row.email,
        positionTitle: row.positionTitle,
        hireDate: row.hireDate.toISOString().slice(0, 10),
        status: row.status,
      };
    });

    return { items, total, page, pageSize };
  }

  async findByRfcs(rfcs: readonly string[]): Promise<EmployeeRfcOwner[]> {
    if (rfcs.length === 0) return [];
    const rows = await this.deps.database.client.employee.findMany({
      where: { rfc: { in: [...rfcs] } },
      select: {
        id: true,
        companyId: true,
        firstName: true,
        lastName: true,
        rfc: true,
        status: true,
      },
    });
    return rows.flatMap((row) =>
      row.rfc === null
        ? []
        : [
            {
              id: row.id,
              companyId: row.companyId,
              fullName: `${row.firstName} ${row.lastName}`,
              rfc: row.rfc,
              active: row.status === 'ACTIVE',
            },
          ],
    );
  }

  async rfcsInCompanies(companyIds: readonly string[]): Promise<string[]> {
    if (companyIds.length === 0) return [];
    const rows = await this.deps.database.client.employee.findMany({
      where: { companyId: { in: [...companyIds] }, rfc: { not: null } },
      select: { rfc: true },
    });
    return rows.flatMap((row) => (row.rfc === null ? [] : [row.rfc]));
  }

  async listActiveOnSite(siteId: string): Promise<SiteMember[]> {
    const rows = await this.deps.database.client.employee.findMany({
      where: { siteId, status: 'ACTIVE' },
      select: { id: true, companyId: true, firstName: true, lastName: true, rfc: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      fullName: `${row.firstName} ${row.lastName}`,
      rfc: row.rfc,
    }));
  }
}
