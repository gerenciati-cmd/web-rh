/**
 * API PÚBLICA del módulo organization. Otros módulos SOLO pueden importar desde aquí
 * (regla verificada por dependency-cruiser en `pnpm arch:check`).
 */
export type {
  CompanySummary,
  OrganizationApi,
  SiteSummary,
} from './application/organization.facade';
export { COMPANY_CREATED } from './domain/company';
export { organizationModule, type OrganizationCradle } from './organization.module';
