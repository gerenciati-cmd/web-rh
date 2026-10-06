import { asClass } from 'awilix';

import type { AppModule } from '@/shared/app-module';

import { AssignDeviceSite } from './application/commands/assign-device-site.command';
import { CompleteDeviceCommands } from './application/commands/complete-device-commands.command';
import { QueueDeviceCommand } from './application/commands/queue-device-command.command';
import { RecordDeviceContact } from './application/commands/record-device-contact.command';
import { RecordDevicePush } from './application/commands/record-device-push.command';
import { RegisterDevice } from './application/commands/register-device.command';
import { TakeDeviceCommand } from './application/commands/take-device-command.command';
import type { PunchOwnerDirectory } from './application/ports/punch-owner-directory';
import type { SiteDirectory } from './application/ports/site-directory';
import type { AttendanceQueries } from './application/queries/attendance.queries';
import { ListDeviceCommands } from './application/queries/list-device-commands.query';
import { ListDevices } from './application/queries/list-devices.query';
import { ListPunches } from './application/queries/list-punches.query';
import type { DeviceCommandRepository } from './domain/device-command.repository';
import type { DeviceRepository } from './domain/device.repository';
import type { PunchRepository } from './domain/punch.repository';
import { createAttendanceRouter } from './http/attendance.router';
import { createZktecoAdmsRouter } from './http/zkteco-adms.router';
import { EmployeesPunchOwnerDirectory } from './infrastructure/employees-punch-owner-directory';
import { OrganizationSiteDirectory } from './infrastructure/organization-site-directory';
import { PrismaAttendanceQueries } from './infrastructure/prisma-attendance.queries';
import { PrismaDeviceCommandRepository } from './infrastructure/prisma-device-command.repository';
import { PrismaDeviceRepository } from './infrastructure/prisma-device.repository';
import { PrismaPunchRepository } from './infrastructure/prisma-punch.repository';

export interface AttendanceCradle {
  deviceRepository: DeviceRepository;
  punchRepository: PunchRepository;
  attendanceQueries: AttendanceQueries;
  punchOwnerDirectory: PunchOwnerDirectory;
  deviceSiteDirectory: SiteDirectory;
  registerDevice: RegisterDevice;
  assignDeviceSite: AssignDeviceSite;
  listDevices: ListDevices;
  listPunches: ListPunches;
  recordDeviceContact: RecordDeviceContact;
  recordDevicePush: RecordDevicePush;
  deviceCommandRepository: DeviceCommandRepository;
  queueDeviceCommand: QueueDeviceCommand;
  takeDeviceCommand: TakeDeviceCommand;
  completeDeviceCommands: CompleteDeviceCommands;
  listDeviceCommands: ListDeviceCommands;
}

export const attendanceModule: AppModule<AttendanceCradle> = {
  name: 'attendance',
  registrations: {
    // Persistencia
    deviceRepository: asClass(PrismaDeviceRepository).singleton(),
    punchRepository: asClass(PrismaPunchRepository).singleton(),
    deviceCommandRepository: asClass(PrismaDeviceCommandRepository).singleton(),
    attendanceQueries: asClass(PrismaAttendanceQueries).singleton(),
    punchOwnerDirectory: asClass(EmployeesPunchOwnerDirectory).singleton(),
    deviceSiteDirectory: asClass(OrganizationSiteDirectory).singleton(),
    // Casos de uso
    registerDevice: asClass(RegisterDevice).singleton(),
    assignDeviceSite: asClass(AssignDeviceSite).singleton(),
    listDevices: asClass(ListDevices).singleton(),
    listPunches: asClass(ListPunches).singleton(),
    recordDeviceContact: asClass(RecordDeviceContact).singleton(),
    recordDevicePush: asClass(RecordDevicePush).singleton(),
    queueDeviceCommand: asClass(QueueDeviceCommand).singleton(),
    takeDeviceCommand: asClass(TakeDeviceCommand).singleton(),
    completeDeviceCommands: asClass(CompleteDeviceCommands).singleton(),
    listDeviceCommands: asClass(ListDeviceCommands).singleton(),
  },
  router: createAttendanceRouter,
  deviceRouter: createZktecoAdmsRouter,
  // El checador pregunta por comandos cada ~10 s (`Delay=10`).
  quietRequestPaths: ['/iclock/getrequest'],
};
