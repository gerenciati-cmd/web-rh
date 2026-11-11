import {
  attendanceDeviceCommandRoutes,
  attendanceDeviceRoutes,
  attendanceLatenessRuleRoutes,
  attendancePunchRoutes,
  attendanceShiftRoutes,
  attendanceWorkdayRoutes,
  myAttendanceRoutes,
} from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';
import { requireActor } from '@/http/request-context';

import type { AssignDeviceSite } from '../application/commands/assign-device-site.command';
import type { AssignEmployeeShift } from '../application/commands/assign-employee-shift.command';
import type { CreateShift } from '../application/commands/create-shift.command';
import type { QueueDeviceCommand } from '../application/commands/queue-device-command.command';
import type { RecalculateWorkdays } from '../application/commands/recalculate-workdays.command';
import type { RegisterDevice } from '../application/commands/register-device.command';
import type { SetDeviceNetworks } from '../application/commands/set-device-networks.command';
import type { SetLatenessRule } from '../application/commands/set-lateness-rule.command';
import type { SyncDevice } from '../application/commands/sync-device.command';
import type { GetMyAttendanceToday } from '../application/queries/get-my-attendance-today.query';
import type { ListDeviceCommands } from '../application/queries/list-device-commands.query';
import type { ListDevices } from '../application/queries/list-devices.query';
import type { ListEmployeeShiftAssignments } from '../application/queries/list-employee-shift-assignments.query';
import type { ListEmployeeWorkdays } from '../application/queries/list-employee-workdays.query';
import type { ListLatenessRules } from '../application/queries/list-lateness-rules.query';
import type { ListMyWorkdays } from '../application/queries/list-my-workdays.query';
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
  setLatenessRule: SetLatenessRule;
  listLatenessRules: ListLatenessRules;
  recalculateWorkdays: RecalculateWorkdays;
  listEmployeeWorkdays: ListEmployeeWorkdays;
  listMyWorkdays: ListMyWorkdays;
  getMyAttendanceToday: GetMyAttendanceToday;
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

  bindRoute(router, attendanceLatenessRuleRoutes.setLatenessRule, async ({ params, body }, ctx) => {
    unwrap(
      await deps.setLatenessRule.execute({
        companyId: params.companyId,
        effectiveFrom: params.effectiveFrom,
        threshold: body.threshold,
        period: body.period,
        setBy: requireActor(ctx).userId,
      }),
    );
    return undefined;
  });

  bindRoute(router, attendanceLatenessRuleRoutes.listLatenessRules, async ({ params }) =>
    unwrap(await deps.listLatenessRules.execute({ companyId: params.companyId })),
  );

  bindRoute(router, attendanceWorkdayRoutes.recalculateEmployeeWorkdays, async ({ params, body }) =>
    unwrap(await deps.recalculateWorkdays.execute({ ...params, ...body })),
  );

  bindRoute(router, attendanceWorkdayRoutes.listEmployeeWorkdays, async ({ params, query }) =>
    unwrap(await deps.listEmployeeWorkdays.execute({ ...params, ...query })),
  );

  // El colaborador sale del actor (`authorize` ya exigió uno), nunca de la ruta.
  bindRoute(router, myAttendanceRoutes.listMyWorkdays, async ({ query }, ctx) =>
    unwrap(
      await deps.listMyWorkdays.execute({
        employeeId: ctx.actor?.employeeId ?? null,
        month: query.month,
      }),
    ),
  );

  bindRoute(router, myAttendanceRoutes.getMyAttendanceToday, async (_request, ctx) =>
    unwrap(await deps.getMyAttendanceToday.execute({ employeeId: ctx.actor?.employeeId ?? null })),
  );

  return router;
}
