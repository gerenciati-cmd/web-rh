import {
  attendanceDeviceCommandRoutes,
  attendanceDeviceRoutes,
  attendancePunchRoutes,
  attendanceShiftRoutes,
} from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';
import { requireActor } from '@/http/request-context';

import type { AssignDeviceSite } from '../application/commands/assign-device-site.command';
import type { AssignEmployeeShift } from '../application/commands/assign-employee-shift.command';
import type { CreateShift } from '../application/commands/create-shift.command';
import type { QueueDeviceCommand } from '../application/commands/queue-device-command.command';
import type { RegisterDevice } from '../application/commands/register-device.command';
import type { SetDeviceNetworks } from '../application/commands/set-device-networks.command';
import type { SyncDevice } from '../application/commands/sync-device.command';
import type { ListDeviceCommands } from '../application/queries/list-device-commands.query';
import type { ListDevices } from '../application/queries/list-devices.query';
import type { ListEmployeeShiftAssignments } from '../application/queries/list-employee-shift-assignments.query';
import type { ListPunches } from '../application/queries/list-punches.query';
import type { ListShifts } from '../application/queries/list-shifts.query';

/** Adaptador HTTP delgado de `/api/v1/attendance/*` (el protocolo del equipo vive en `/iclock`). */
export function createAttendanceRouter(deps: {
  listDevices: ListDevices;
  registerDevice: RegisterDevice;
  assignDeviceSite: AssignDeviceSite;
  setDeviceNetworks: SetDeviceNetworks;
  syncDevice: SyncDevice;
  listPunches: ListPunches;
  queueDeviceCommand: QueueDeviceCommand;
  listDeviceCommands: ListDeviceCommands;
  listShifts: ListShifts;
  createShift: CreateShift;
  assignEmployeeShift: AssignEmployeeShift;
  listEmployeeShiftAssignments: ListEmployeeShiftAssignments;
}): Router {
  const router = Router();

  bindRoute(router, attendanceDeviceRoutes.listDevices, ({ query }) =>
    deps.listDevices.execute(query),
  );

  bindRoute(router, attendanceDeviceRoutes.registerDevice, async ({ body }) =>
    unwrap(await deps.registerDevice.execute(body)),
  );

  bindRoute(router, attendanceDeviceRoutes.assignDeviceSite, async ({ params, body }) => {
    unwrap(await deps.assignDeviceSite.execute({ deviceId: params.deviceId, siteId: body.siteId }));
    return undefined;
  });

  bindRoute(router, attendanceDeviceRoutes.setDeviceNetworks, async ({ params, body }) => {
    unwrap(
      await deps.setDeviceNetworks.execute({
        deviceId: params.deviceId,
        allowedNetworks: body.allowedNetworks,
      }),
    );
    return undefined;
  });

  bindRoute(router, attendanceDeviceRoutes.syncDevice, async ({ params }, ctx) =>
    unwrap(
      await deps.syncDevice.execute({
        deviceId: params.deviceId,
        queuedBy: requireActor(ctx).userId,
      }),
    ),
  );

  bindRoute(
    router,
    attendanceDeviceCommandRoutes.queueDeviceCommand,
    async ({ params, body }, ctx) =>
      unwrap(
        await deps.queueDeviceCommand.execute({
          deviceId: params.deviceId,
          command: body.command,
          queuedBy: requireActor(ctx).userId,
        }),
      ),
  );

  bindRoute(router, attendanceDeviceCommandRoutes.listDeviceCommands, async ({ params, query }) =>
    unwrap(await deps.listDeviceCommands.execute({ ...query, deviceId: params.deviceId })),
  );

  bindRoute(router, attendancePunchRoutes.listPunches, ({ query }, ctx) =>
    deps.listPunches.execute({ ...query, actor: requireActor(ctx) }),
  );

  bindRoute(router, attendanceShiftRoutes.listShifts, ({ params, query }) =>
    deps.listShifts.execute({ ...query, companyId: params.companyId }),
  );

  bindRoute(router, attendanceShiftRoutes.createShift, async ({ params, body }) =>
    unwrap(await deps.createShift.execute({ ...body, companyId: params.companyId })),
  );

  bindRoute(router, attendanceShiftRoutes.assignEmployeeShift, async ({ params, body }, ctx) => {
    unwrap(
      await deps.assignEmployeeShift.execute({
        ...params,
        shiftId: body.shiftId,
        assignedBy: requireActor(ctx).userId,
      }),
    );
    return undefined;
  });

  bindRoute(router, attendanceShiftRoutes.listEmployeeShiftAssignments, async ({ params, query }) =>
    unwrap(await deps.listEmployeeShiftAssignments.execute({ ...query, ...params })),
  );

  return router;
}
