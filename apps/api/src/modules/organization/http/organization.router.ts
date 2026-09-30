import { organizationRoutes as routes } from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';
import { requireActor } from '@/http/request-context';

import type { CreateCompany } from '../application/commands/create-company.command';
import type { GetCompany } from '../application/queries/get-company.query';
import type { ListCompanies } from '../application/queries/list-companies.query';

/**
 * Adaptador HTTP delgado: traduce HTTP ↔ caso de uso. Cero lógica de negocio aquí.
 * La validación de entrada la hace `bindRoute` usando el contrato compartido.
 */
export function createOrganizationRouter(deps: {
  createCompany: CreateCompany;
  listCompanies: ListCompanies;
  getCompany: GetCompany;
}): Router {
  const router = Router();

  bindRoute(router, routes.listCompanies, ({ query }, ctx) =>
    deps.listCompanies.execute({ ...query, actor: requireActor(ctx) }),
  );

  bindRoute(router, routes.getCompany, async ({ params }) =>
    unwrap(await deps.getCompany.execute(params)),
  );

  bindRoute(router, routes.createCompany, async ({ body }) =>
    unwrap(await deps.createCompany.execute(body)),
  );

  return router;
}
