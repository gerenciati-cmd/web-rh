import { employeeRoutes as routes } from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';

import type { AssignEmployeeRfc } from '../application/commands/assign-employee-rfc.command';
import type { AssignEmployeeSite } from '../application/commands/assign-employee-site.command';
import type { RegisterEmployee } from '../application/commands/register-employee.command';
import type { ListEmployees } from '../application/queries/list-employees.query';

export function createEmployeesRouter(deps: {
  registerEmployee: RegisterEmployee;
  assignEmployeeRfc: AssignEmployeeRfc;
  assignEmployeeSite: AssignEmployeeSite;
  listEmployees: ListEmployees;
}): Router {
  const router = Router();

  bindRoute(router, routes.listEmployees, ({ params, query }) =>
    deps.listEmployees.execute({ ...query, companyId: params.companyId }),
  );

  bindRoute(router, routes.registerEmployee, async ({ params, body }) =>
    unwrap(await deps.registerEmployee.execute({ ...body, companyId: params.companyId })),
  );

  bindRoute(router, routes.assignEmployeeRfc, async ({ params, body }) => {
    unwrap(await deps.assignEmployeeRfc.execute({ ...params, rfc: body.rfc }));
    return undefined;
  });

  bindRoute(router, routes.assignEmployeeSite, async ({ params, body }) => {
    unwrap(await deps.assignEmployeeSite.execute({ ...params, siteId: body.siteId }));
    return undefined;
  });

  return router;
}
