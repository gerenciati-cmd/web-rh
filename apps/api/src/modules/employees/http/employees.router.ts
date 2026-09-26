import { employeeRoutes as routes } from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';

import type { RegisterEmployee } from '../application/commands/register-employee.command';
import type { ListEmployees } from '../application/queries/list-employees.query';

export function createEmployeesRouter(deps: {
  registerEmployee: RegisterEmployee;
  listEmployees: ListEmployees;
}): Router {
  const router = Router();

  bindRoute(router, routes.listEmployees, ({ params, query }) =>
    deps.listEmployees.execute({ ...query, companyId: params.companyId }),
  );

  bindRoute(router, routes.registerEmployee, async ({ params, body }) =>
    unwrap(await deps.registerEmployee.execute({ ...body, companyId: params.companyId })),
  );

  return router;
}
