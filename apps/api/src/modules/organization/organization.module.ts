import { asClass } from 'awilix';

import type { AppModule } from '@/shared/app-module';

import { CreateCompany } from './application/commands/create-company.command';
import { OrganizationFacade, type OrganizationApi } from './application/organization.facade';
import type { CompanyQueries } from './application/queries/company.queries';
import { GetCompany } from './application/queries/get-company.query';
import { ListCompanies } from './application/queries/list-companies.query';
import type { CompanyRepository } from './domain/company.repository';
import { createOrganizationRouter } from './http/organization.router';
import { PrismaCompanyQueries } from './infrastructure/prisma-company.queries';
import { PrismaCompanyRepository } from './infrastructure/prisma-company.repository';

export interface OrganizationCradle {
  companyRepository: CompanyRepository;
  companyQueries: CompanyQueries;
  createCompany: CreateCompany;
  listCompanies: ListCompanies;
  getCompany: GetCompany;
  organizationApi: OrganizationApi;
}

export const organizationModule: AppModule<OrganizationCradle> = {
  name: 'organization',
  registrations: {
    // Puertos → adaptadores. Cambiar de Prisma a otra cosa = cambiar SOLO estas líneas.
    companyRepository: asClass(PrismaCompanyRepository).singleton(),
    companyQueries: asClass(PrismaCompanyQueries).singleton(),
    // Casos de uso
    createCompany: asClass(CreateCompany).singleton(),
    listCompanies: asClass(ListCompanies).singleton(),
    getCompany: asClass(GetCompany).singleton(),
    // API pública para otros módulos
    organizationApi: asClass(OrganizationFacade).singleton(),
  },
  router: createOrganizationRouter,
};
