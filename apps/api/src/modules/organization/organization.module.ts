import { asClass } from 'awilix';

import type { AppModule } from '@/shared/app-module';

import { CreateCompany } from './application/commands/create-company.command';
import { CreateSite } from './application/commands/create-site.command';
import { OrganizationFacade, type OrganizationApi } from './application/organization.facade';
import type { CompanyQueries } from './application/queries/company.queries';
import { GetCompany } from './application/queries/get-company.query';
import { ListCompanies } from './application/queries/list-companies.query';
import { ListSites } from './application/queries/list-sites.query';
import type { SiteQueries } from './application/queries/site.queries';
import type { CompanyRepository } from './domain/company.repository';
import type { SiteRepository } from './domain/site.repository';
import { createOrganizationRouter } from './http/organization.router';
import { PrismaCompanyQueries } from './infrastructure/prisma-company.queries';
import { PrismaCompanyRepository } from './infrastructure/prisma-company.repository';
import { PrismaSiteQueries } from './infrastructure/prisma-site.queries';
import { PrismaSiteRepository } from './infrastructure/prisma-site.repository';

export interface OrganizationCradle {
  companyRepository: CompanyRepository;
  companyQueries: CompanyQueries;
  createCompany: CreateCompany;
  listCompanies: ListCompanies;
  getCompany: GetCompany;
  siteRepository: SiteRepository;
  siteQueries: SiteQueries;
  createSite: CreateSite;
  listSites: ListSites;
  organizationApi: OrganizationApi;
}

export const organizationModule: AppModule<OrganizationCradle> = {
  name: 'organization',
  registrations: {
    // Puertos → adaptadores. Cambiar de Prisma a otra cosa = cambiar SOLO estas líneas.
    companyRepository: asClass(PrismaCompanyRepository).singleton(),
    companyQueries: asClass(PrismaCompanyQueries).singleton(),
    siteRepository: asClass(PrismaSiteRepository).singleton(),
    siteQueries: asClass(PrismaSiteQueries).singleton(),
    // Casos de uso
    createCompany: asClass(CreateCompany).singleton(),
    listCompanies: asClass(ListCompanies).singleton(),
    getCompany: asClass(GetCompany).singleton(),
    createSite: asClass(CreateSite).singleton(),
    listSites: asClass(ListSites).singleton(),
    // API pública para otros módulos
    organizationApi: asClass(OrganizationFacade).singleton(),
  },
  router: createOrganizationRouter,
};
