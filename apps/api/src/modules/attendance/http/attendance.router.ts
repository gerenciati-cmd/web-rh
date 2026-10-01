import { attendanceDeviceRoutes, attendancePunchRoutes } from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';
import { requireActor } from '@/http/request-context';

import type { RegisterDevice } from '../application/commands/register-device.command';
import type { ListDevices } from '../application/queries/list-devices.query';
import type { ListPunches } from '../application/queries/list-punches.query';

/** Adaptador HTTP delgado de `/api/v1/attendance/*` (el protocolo del equipo vive en `/iclock`). */
export function createAttendanceRouter(deps: {
  listDevices: ListDevices;
  registerDevice: RegisterDevice;
  listPunches: ListPunches;
}): Router {
  const router = Router();

  bindRoute(router, attendanceDeviceRoutes.listDevices, ({ query }) =>
    deps.listDevices.execute(query),
  );

  bindRoute(router, attendanceDeviceRoutes.registerDevice, async ({ body }) =>
    unwrap(await deps.registerDevice.execute(body)),
  );

  bindRoute(router, attendancePunchRoutes.listPunches, ({ query }, ctx) =>
    deps.listPunches.execute({ ...query, actor: requireActor(ctx) }),
  );

  return router;
}
