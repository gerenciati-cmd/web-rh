/**
 * Datos de desarrollo. Pasa por los CASOS DE USO (no inserta filas a mano), así los datos
 * de prueba respetan las mismas reglas que producción. Idempotente: se puede correr varias veces.
 *
 *   pnpm db:seed
 */
import { loadEnv } from '@/config/env';
import { buildContainer } from '@/container';
import { createLogger } from '@/infrastructure/logging/pino-logger';

const env = loadEnv();
const logger = createLogger(env);
const container = buildContainer(env, logger);
const { createCompany, registerEmployee, listCompanies, registerUser } = container.cradle;

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

const { items } = await listCompanies.execute({ page: 1, pageSize: 10 });
const holding = items.find((company) => company.legalName === 'APS Holding S.A. de C.V.');

if (holding) {
  const employees = [
    {
      nationalId: 'GOMA850101HQRRRN04',
      firstName: 'Ana',
      lastName: 'Rojas',
      email: 'ana.rojas@example.com',
      positionTitle: 'Analista de RRHH',
    },
    {
      nationalId: 'PEXL900215MDFRPR07',
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
      nationalId: { country: 'MX', number: employee.nationalId },
      hireDate: '2026-01-05',
    });
    if (result.ok) logger.info({ employee: employee.email }, 'colaborador registrado');
    else if (result.error.code !== 'EMPLOYEE_ALREADY_EXISTS') throw result.error;
  }
}

if (env.SEED_USER_PASSWORD) {
  const result = await registerUser.execute({
    email: 'admin@example.com',
    password: env.SEED_USER_PASSWORD,
  });
  if (result.ok) logger.info({ email: 'admin@example.com' }, 'usuario creado');
  else if (result.error.code !== 'USER_ALREADY_EXISTS') throw result.error;
} else {
  logger.info('SEED_USER_PASSWORD no está definida: se omite la creación del usuario admin');
}

await container.dispose();
logger.info('seed completado');
