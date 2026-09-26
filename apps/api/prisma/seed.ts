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
const { createCompany, registerEmployee, listCompanies } = container.cradle;

const companies = [
  { legalName: 'APS Holding SpA', taxId: '76.086.428-5', country: 'CL' as const },
  { legalName: 'APS Servicios Ltda.', taxId: '77.777.777-7', country: 'CL' as const },
];

for (const company of companies) {
  const result = await createCompany.execute(company);
  if (result.ok) logger.info({ company: company.legalName }, 'empresa creada');
  else if (result.error.code !== 'COMPANY_ALREADY_EXISTS') throw result.error;
}

const { items } = await listCompanies.execute({ page: 1, pageSize: 10 });
const holding = items.find((company) => company.legalName === 'APS Holding SpA');

if (holding) {
  const employees = [
    {
      nationalId: '12.345.678-5',
      firstName: 'Ana',
      lastName: 'Rojas',
      email: 'ana.rojas@aps.cl',
      positionTitle: 'Analista de RRHH',
    },
    {
      nationalId: '7.654.321-6',
      firstName: 'Pedro',
      lastName: 'Soto',
      email: 'pedro.soto@aps.cl',
      positionTitle: 'Jefe de Operaciones',
    },
  ];
  for (const employee of employees) {
    const result = await registerEmployee.execute({
      ...employee,
      companyId: holding.id,
      nationalId: { country: 'CL', number: employee.nationalId },
      hireDate: '2026-01-05',
    });
    if (result.ok) logger.info({ employee: employee.email }, 'colaborador registrado');
    else if (result.error.code !== 'EMPLOYEE_ALREADY_EXISTS') throw result.error;
  }
}

await container.dispose();
logger.info('seed completado');
