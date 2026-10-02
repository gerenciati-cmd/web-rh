/**
 * Datos de desarrollo. Pasa por los CASOS DE USO (no inserta filas a mano), así los datos
 * de prueba respetan las mismas reglas que producción. Idempotente: se puede correr varias veces.
 *
 *   pnpm db:seed
 */
import type { Role } from '@rrhh/domain';

import { loadEnv } from '@/config/env';
import { buildContainer } from '@/container';
import { createLogger } from '@/infrastructure/logging/pino-logger';
import type { Actor } from '@/shared/application/actor';

const env = loadEnv();
const logger = createLogger(env);
const container = buildContainer(env, logger);
const {
  createCompany,
  createSite,
  listSites,
  registerEmployee,
  listCompanies,
  registerUser,
  listUsers,
  assignRole,
} = container.cradle;

// El seed corre sin sesión: actúa como el sistema, con lectura de todo el holding.
const seedActor: Actor = {
  userId: 'seed',
  sessionId: 'seed',
  grants: [{ permission: 'organization.companies:read', companyId: null }],
};

// Identificadores sintéticos válidos (uno por país soportado, ADR 0009).
const companies = [
  { legalName: 'APS Holding S.A. de C.V.', taxId: 'EKU9003173C9', country: 'MX' as const },
  { legalName: 'APS Servicios RD S.R.L.', taxId: '131246796', country: 'DO' as const },
  { legalName: 'APS Servicios Colombia S.A.S.', taxId: '900123456-8', country: 'CO' as const },
];

for (const company of companies) {
  const result = await createCompany.execute(company);
  if (result.ok) logger.info({ company: company.legalName }, 'empresa creada');
  else if (result.error.code !== 'COMPANY_ALREADY_EXISTS') throw result.error;
}

const { items } = await listCompanies.execute({ page: 1, pageSize: 10, actor: seedActor });
const holding = items.find((company) => company.legalName === 'APS Holding S.A. de C.V.');

/** Crea la sede (o la reutiliza si ya existe) y devuelve su id. */
async function seedSite(name: string): Promise<string> {
  const result = await createSite.execute({ name, country: 'MX', timeZone: 'America/Cancun' });
  if (result.ok) {
    logger.info({ site: name }, 'sede creada');
    return result.value.id;
  }
  if (result.error.code !== 'SITE_ALREADY_EXISTS') throw result.error;

  const found = await listSites.execute({ page: 1, pageSize: 100 });
  const existing = found.items.find((site) => site.name === name);
  if (!existing) throw new Error(`No se encontró la sede ya existente ${name}`);
  return existing.id;
}

if (holding) {
  const siteId = await seedSite('Cancún Centro');
  const employees = [
    {
      nationalId: 'GOMA850101HQRRRN04',
      rfc: 'GOMA850101AB1',
      firstName: 'Ana',
      lastName: 'Rojas',
      email: 'ana.rojas@example.com',
      positionTitle: 'Analista de RRHH',
    },
    {
      nationalId: 'PEXL900215MDFRPR07',
      rfc: 'PEXL900215AB2',
      firstName: 'Pedro',
      lastName: 'Soto',
      email: 'pedro.soto@example.com',
      positionTitle: 'Jefe de Operaciones',
    },
  ];
  for (const employee of employees) {
    const result = await registerEmployee.execute({
      ...employee,
      companyId: holding.id,
      siteId,
      nationalId: { country: 'MX', number: employee.nationalId },
      hireDate: '2026-01-05',
    });
    if (result.ok) logger.info({ employee: employee.email }, 'colaborador registrado');
    else if (result.error.code !== 'EMPLOYEE_ALREADY_EXISTS') throw result.error;
  }
}

/** Crea el usuario (o lo reutiliza si ya existe) y devuelve su id. */
async function seedUser(email: string, password: string): Promise<string> {
  const result = await registerUser.execute({ email, password });
  if (result.ok) {
    logger.info({ email }, 'usuario creado');
    return result.value.id;
  }
  if (result.error.code !== 'USER_ALREADY_EXISTS') throw result.error;

  const found = await listUsers.execute({ page: 1, pageSize: 100, search: email });
  const existing = found.items.find((user) => user.email === email);
  if (!existing) throw new Error(`No se encontró el usuario ya existente ${email}`);
  return existing.id;
}

async function seedRole(userId: string, role: Role, companyId: string | null): Promise<void> {
  const result = await assignRole.execute({ userId, role, companyId, assignedBy: null });
  if (result.ok) logger.info({ role, companyId }, 'rol asignado');
  else if (result.error.code !== 'ROLE_ALREADY_ASSIGNED') throw result.error;
}

if (env.SEED_USER_PASSWORD) {
  const adminId = await seedUser('admin@example.com', env.SEED_USER_PASSWORD);
  await seedRole(adminId, 'HOLDING_ADMIN', null);

  if (holding) {
    const hrId = await seedUser('rrhh@example.com', env.SEED_USER_PASSWORD);
    await seedRole(hrId, 'HR', holding.id);
  }
} else {
  logger.info('SEED_USER_PASSWORD no está definida: se omite la creación del usuario admin');
}

await container.dispose();
logger.info('seed completado');
