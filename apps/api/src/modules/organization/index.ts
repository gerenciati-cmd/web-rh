/**
 * API PÚBLICA del módulo organization. Otros módulos SOLO pueden importar desde aquí
 * (regla verificada por dependency-cruiser en `pnpm arch:check`).
 */
export type { CompanySummary, OrganizationApi } from './application/organization.facade';
export { CompanyCreated } from './domain/company';
export { organizationModule, type OrganizationCradle } from './organization.module';
