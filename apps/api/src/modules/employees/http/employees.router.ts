import { employeeRoutes as routes } from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';

import type { AssignEmployeeRfc } from '../application/commands/assign-employee-rfc.command';
import type { RegisterEmployee } from '../application/commands/register-employee.command';
import type { ListEmployees } from '../application/queries/list-employees.query';

export function createEmployeesRouter(deps: {
  registerEmployee: RegisterEmployee;
  assignEmployeeRfc: AssignEmployeeRfc;
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

  return router;
}
