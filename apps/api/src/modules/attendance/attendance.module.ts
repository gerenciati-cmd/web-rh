import { asClass } from 'awilix';

import type { AppModule } from '@/shared/app-module';

import { RecordDeviceContact } from './application/commands/record-device-contact.command';
import { RecordDevicePush } from './application/commands/record-device-push.command';
import { RegisterDevice } from './application/commands/register-device.command';
import type { PunchOwnerDirectory } from './application/ports/punch-owner-directory';
import type { AttendanceQueries } from './application/queries/attendance.queries';
import { ListDevices } from './application/queries/list-devices.query';
import { ListPunches } from './application/queries/list-punches.query';
import type { DeviceRepository } from './domain/device.repository';
import type { PunchRepository } from './domain/punch.repository';
import { createAttendanceRouter } from './http/attendance.router';
import { createZktecoAdmsRouter } from './http/zkteco-adms.router';
import { EmployeesPunchOwnerDirectory } from './infrastructure/employees-punch-owner-directory';
import { PrismaAttendanceQueries } from './infrastructure/prisma-attendance.queries';
import { PrismaDeviceRepository } from './infrastructure/prisma-device.repository';
import { PrismaPunchRepository } from './infrastructure/prisma-punch.repository';

export interface AttendanceCradle {
  deviceRepository: DeviceRepository;
  punchRepository: PunchRepository;
  attendanceQueries: AttendanceQueries;
  punchOwnerDirectory: PunchOwnerDirectory;
  registerDevice: RegisterDevice;
  listDevices: ListDevices;
  listPunches: ListPunches;
  recordDeviceContact: RecordDeviceContact;
  recordDevicePush: RecordDevicePush;
}

export const attendanceModule: AppModule<AttendanceCradle> = {
  name: 'attendance',
  registrations: {
    // Persistencia
    deviceRepository: asClass(PrismaDeviceRepository).singleton(),
    punchRepository: asClass(PrismaPunchRepository).singleton(),
    attendanceQueries: asClass(PrismaAttendanceQueries).singleton(),
    punchOwnerDirectory: asClass(EmployeesPunchOwnerDirectory).singleton(),
    // Casos de uso
    registerDevice: asClass(RegisterDevice).singleton(),
    listDevices: asClass(ListDevices).singleton(),
    listPunches: asClass(ListPunches).singleton(),
    recordDeviceContact: asClass(RecordDeviceContact).singleton(),
    recordDevicePush: asClass(RecordDevicePush).singleton(),
  },
  router: createAttendanceRouter,
  deviceRouter: createZktecoAdmsRouter,
};
